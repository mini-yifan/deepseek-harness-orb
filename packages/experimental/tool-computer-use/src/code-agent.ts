/**
 * Computer Use-only tool that creates or continues a first-class standard Session.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/code-agent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCreateRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { watchCodeAgentCompletion } from './code-agent-completion.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-tools'

type WorkspaceId = NonNullable<SessionCreateRequest['workspaceId']>

interface OrbCodeAgentModel {
  currentSelection(): {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  } | undefined
}

/** Cordis plugin name. */
export const name = 'tool-code-agent'

/** Services required at apply time. Missing Session Remote keeps the plugin pending. */
export const inject = ['tools', 'sessionController']

/** Model-visible tool name. */
export const TOOL_NAME = 'code_agent'

const DESCRIPTION = 'Delegate background coding and document work to a standard-mode Code agent that appears in the desktop sidebar like a user-created session. '
  + 'Do not call this tool for visible GUI work such as opening WeChat or clicking a button in Pages — use the GUI tools instead. '
  + 'Omit session_id to create a new blank standard session: write a Word document, make a gobang game, or any task that is not a follow-up to a previous code_agent result. '
  + 'Pass session_id with the id returned by an earlier code_agent result when continuing the same artifact, for example making that Word document\'s font green. '
  + 'Do not pass a previous id when the new work is unrelated. '
  + 'task is the user message to enqueue. The call returns after the standard session accepts the message; it does not wait for that session to finish. '
  + 'Tell the user the background Code agent is running, then end the turn. Do not call wait, long_wait, or bash sleep to poll that session. '
  + 'A plugin notice arrives later when that session is idle and this session is idle; then tell the user what the Code agent produced. '
  + 'cwd defaults to this session\'s workspace; omit it unless the new session needs a different directory. '
  + 'session_id cannot target this Computer Use session, a subagent child, or a non-standard session.'

interface HeaderFacts {
  readonly id: SessionId
  readonly origin?: 'subagent'
  readonly agentPreset?: string
  readonly cwd?: string
  readonly parentSession?: SessionId
}

function requireAgent(exec: { agent?: { id: SessionId; session: { header: HeaderFacts } } }): {
  id: SessionId
  session: { header: HeaderFacts }
} {
  if (exec.agent === undefined) {
    throw new Error('code_agent requires a calling Computer Use session')
  }
  return exec.agent
}

/**
 * Resolve a Workspace id when `directory` is already registered.
 * @param ctx - Host context; `workspaceRegistry` is optional.
 * @param directory - session cwd or explicit `code_agent` cwd.
 * @returns the branded Workspace id, or undefined when none matches.
 */
async function workspaceIdForDirectory(
  ctx: Context,
  directory: string | undefined,
): Promise<WorkspaceId | undefined> {
  if (directory === undefined || directory === '') return undefined
  const registry = ctx.get('workspaceRegistry') as
    | { resolveByPath(path: string): Promise<{ id: string } | undefined> }
    | undefined
  if (registry === undefined || typeof registry.resolveByPath !== 'function') return undefined
  try {
    const id = (await registry.resolveByPath(directory))?.id
    return id === undefined ? undefined : brandString<WorkspaceId>(id)
  } catch {
    // Missing or relative directories cannot join a Workspace record.
    return undefined
  }
}

/**
 * Prefer `workspaceId` so the new session appears under that sidebar folder.
 * @param ctx - Host context; `workspaceRegistry` is optional.
 * @param directory - session cwd or explicit `code_agent` cwd.
 * @returns create fields that `session.create` accepts together.
 */
async function locationForCreate(
  ctx: Context,
  directory: string | undefined,
): Promise<Pick<SessionCreateRequest, 'workspaceId'> | Pick<SessionCreateRequest, 'cwd'> | Record<string, never>> {
  const workspaceId = await workspaceIdForDirectory(ctx, directory)
  if (workspaceId !== undefined) return { workspaceId }
  if (directory === undefined) return {}
  return { cwd: directory }
}

function ownedBySubagent(
  ctx: Context,
  header: HeaderFacts,
): boolean {
  const parentId = header.parentSession
  if (parentId === undefined) return false
  const agents = ctx.get('agents')
  if (agents === undefined) return false
  const live = agents.get(header.id)
  const parent = agents.get(parentId)
  return live !== undefined && parent !== undefined && agents.isOwnedBy(live.id, parent)
}

/**
 * Register `code_agent` on the calling Computer Use tool layer.
 * @param ctx - registration scope; `inject` must already be satisfied.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      task: {
        type: 'string',
        required: true,
        description: 'User message to enqueue on a standard session. Required.',
      },
      session_id: {
        type: 'string',
        description:
          'Existing standard session to continue. Omit to create a blank session. '
          + 'Required when following up on the same artifact; forbidden when starting unrelated work.',
      },
      cwd: {
        type: 'string',
        description: 'Workspace directory for a newly created session. Defaults to this Computer Use session\'s cwd.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          created: { type: 'boolean', required: true },
          session_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.created
          ? `Started a new standard session ${value.session_id}. Tell the user the background Code agent is running, then end the turn. Pass this session_id to continue the same artifact.`
          : `Queued on standard session ${value.session_id}. Tell the user the background Code agent is running, then end the turn.`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      title: 'Code agent',
      kind: 'execute',
      rawInput: {
        task: args.task,
        ...(args.session_id === undefined ? {} : { session_id: args.session_id }),
      },
    }),
    async execute(args, exec) {
      const caller = requireAgent(exec)
      const task = args.task.trim()
      if (task === '') throw new Error('code_agent task must include non-whitespace text')
      if (args.session_id !== undefined && args.session_id.trim() === '') {
        throw new Error('code_agent session_id must be omitted or a non-empty id')
      }
      const cwd = args.cwd ?? caller.session.header.cwd
      let sessionId: SessionId
      let created = false
      if (args.session_id === undefined) {
        const createdSession = await ctx.sessionController.create({
          agentPreset: 'standard',
          ...await locationForCreate(ctx, cwd),
        })
        sessionId = createdSession.sessionId
        created = true
        const pref = (ctx.get('orbCodeAgentModel') as OrbCodeAgentModel | undefined)?.currentSelection()
        if (pref !== undefined) {
          await ctx.sessionController.selectModel({
            sessionId,
            provider: pref.provider,
            model: pref.model,
            ...(pref.reasoningEffort === undefined ? {} : { reasoningEffort: pref.reasoningEffort }),
            saveAsDefault: false,
          })
        }
      } else {
        sessionId = brandString<SessionId>(args.session_id)
        if (sessionId === caller.id) {
          throw new Error('code_agent cannot target this Computer Use session')
        }
        const inspected = await ctx.sessionController.inspect(sessionId)
        const header = inspected.meta
        if (header.origin === 'subagent' || ownedBySubagent(ctx, header)) {
          throw new Error(`code_agent cannot continue subagent session "${sessionId}"`)
        }
        if (header.agentPreset !== 'standard') {
          throw new Error(`code_agent can continue only a standard session, not "${header.agentPreset ?? 'unknown'}"`)
        }
        if (args.cwd !== undefined && header.cwd !== undefined && args.cwd !== header.cwd) {
          throw new Error(`code_agent cwd "${args.cwd}" does not match session "${sessionId}" cwd "${header.cwd}"`)
        }
      }
      const requestId = brandString<SessionRequestId>(`code-agent-${randomUUID()}`)
      await ctx.sessionController.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: task }],
      }, exec.signal)
      const agents = ctx.get('agents')
      const liveCaller = agents?.get(caller.id)
      const code = agents?.get(sessionId)
      if (agents !== undefined && liveCaller !== undefined && code !== undefined) {
        watchCodeAgentCompletion({
          caller: liveCaller,
          code,
          agents,
          task,
          sessionId,
          requestId,
        })
      }
      return { accepted: true, created, session_id: sessionId }
    },
  }))
}
