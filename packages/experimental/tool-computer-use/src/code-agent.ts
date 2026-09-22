/**
 * Computer Use-only tools that create, continue, list, and stop first-class
 * standard Sessions for one stretch of file search or file production.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/code-agent
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCreateRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { watchCodeAgentCompletion } from './code-agent-completion.ts'
import { attachUnattendedCodeAgent } from './code-agent-unattended.ts'
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

interface Delegation {
  task: string
  cwd: string
  readonly watches: AbortController[]
}

/** Cordis plugin name. */
export const name = 'tool-code-agent'

/** Services required at apply time. Missing Session Remote keeps the plugin pending. */
export const inject = ['tools', 'sessionController']

/** Model-visible tool that creates or continues a background Code session. */
export const TOOL_NAME = 'code_agent'

/** Model-visible tool that lists this Computer Use caller's Code sessions. */
export const STATUS_TOOL_NAME = 'code_agent_status'

/** Model-visible tool that stops one of this Computer Use caller's Code sessions. */
export const STOP_TOOL_NAME = 'code_agent_stop'

const DESCRIPTION = 'Delegate one stretch of file search or file production to a standard-mode Code agent that appears in the desktop sidebar like a user-created session. '
  + 'Do the stretch in this chat when it is visible GUI or when one search or one command will answer or feed the next click. A second search that you expect will hit the point stays here. '
  + 'Do not call this tool for visible GUI work such as opening WeChat or clicking a button in Pages — use the GUI tools instead. '
  + 'Do not call this tool for a short lookup such as today\'s weather or current headlines — use web_search or web_fetch in this chat. '
  + 'Call this tool when you are still digging through files, searches, or commands, or when the user asked for a file, document, spreadsheet, or site. The last step being a click does not keep the investigation here. '
  + 'Omit session_id to create a new blank standard session: write a Word document, make a gobang game, write an HTML research report, or any task that is not a follow-up to a previous code_agent result. '
  + 'Pass session_id with the id returned by an earlier code_agent result when continuing the same artifact, for example making that Word document\'s font green, or another stretch of the same investigation. '
  + 'Do not pass a previous id when the new work is unrelated. '
  + 'session_id must be a session this Computer Use agent started. '
  + 'task is the stretch to enqueue. The call returns after the standard session accepts the message; it does not wait for that session to finish. '
  + 'Tell the user the background Code agent is running. Continue with a GUI action in this turn only when it does not need this result; otherwise end the turn. Do not call wait, long_wait, or bash sleep to poll that session. '
  + 'A plugin notice arrives later when that session is idle and this session is idle; then decide again: do remaining GUI, or call code_agent with that session_id for another stretch, and tell the user the short conclusion. Do not recite a long report. '
  + 'Pass cwd when the user named a path or said this folder and <frontmost_folder> is present. '
  + 'Omit cwd to create a new subdirectory under this session\'s workspace. '
  + 'session_id cannot target this Computer Use session, a subagent child, or a non-standard session.'

/**
 * Role text appended to every queued `code_agent` task.
 * The completion notice keeps the model task only.
 */
export const BACKGROUND_ROLE = 'You are the background worker for a Computer Use session. You do not see the screen and you do not talk to the user. '
  + 'If this task asks for a file, document, spreadsheet, or site, produce it, reply with its path, and stop. '
  + 'Otherwise search or run commands only until you can answer, including a second search when the first missed the point. '
  + 'Reply in a few sentences with the paths or results that matter, then stop. Do not write a report or create extra files.'

const RUNNING_RESULT = 'Tell the user the background Code agent is running. Continue with a GUI action in this turn only when it does not need this result; otherwise end the turn.'

/**
 * User message queued on the standard session.
 * @param task - trimmed model task. The completion notice quotes this text, not the role.
 * @returns the task plus {@link BACKGROUND_ROLE}.
 */
export function queuedTaskText(task: string): string {
  return `${task}\n\n${BACKGROUND_ROLE}`
}

const STATUS_DESCRIPTION = 'List background Code agent sessions this Computer Use agent started. '
  + 'Returns the count plus each task name, working directory, and running or idle status. '
  + 'Does not include sessions from other Computer Use chats or the main window. '
  + 'Stopped and finished sessions stay listed as idle so they can be continued.'

const STOP_DESCRIPTION = 'Stop a background Code agent this Computer Use agent started. '
  + 'Cancels the current turn and drops queued follow-ups. The session stays idle so a later code_agent call with the same session_id can continue. '
  + 'Does not delete files. session_id is required and must be a session this Computer Use agent started.'

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
 * Directory name derived from the user task.
 * @param task - non-empty trimmed task text.
 * @returns a filesystem-safe slug, or `task` when nothing remains.
 */
export function slugFromTask(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug === '' ? 'task' : slug
}

/**
 * Unique child directory under `parent`.
 * @param parent - Computer Use session cwd.
 * @param slug - {@link slugFromTask} result.
 * @returns `join(parent, slug)` or a numeric suffix when that path exists.
 */
export function uniqueDirectory(parent: string, slug: string): string {
  const base = join(parent, slug)
  if (!existsSync(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!existsSync(candidate)) return candidate
  }
  return `${base}-${randomUUID().slice(0, 8)}`
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

function callerDelegations(
  byCaller: Map<SessionId, Map<SessionId, Delegation>>,
  callerId: SessionId,
): Map<SessionId, Delegation> {
  const existing = byCaller.get(callerId)
  if (existing !== undefined) return existing
  const created = new Map<SessionId, Delegation>()
  byCaller.set(callerId, created)
  return created
}

function rememberCaller(
  liveCaller: Agent,
  callerId: SessionId,
  byCaller: Map<SessionId, Map<SessionId, Delegation>>,
  remembered: WeakSet<Agent>,
): void {
  if (remembered.has(liveCaller)) return
  remembered.add(liveCaller)
  try {
    liveCaller.ctx.effect(() => {
      return () => {
        byCaller.delete(callerId)
        remembered.delete(liveCaller)
      }
    })
  } catch {
    remembered.delete(liveCaller)
    byCaller.delete(callerId)
  }
}

function recordDelegation(
  delegations: Map<SessionId, Delegation>,
  sessionId: SessionId,
  task: string,
  cwd: string,
  watch: AbortController | undefined,
): void {
  const existing = delegations.get(sessionId)
  if (existing === undefined) {
    delegations.set(sessionId, {
      task,
      cwd,
      watches: watch === undefined ? [] : [watch],
    })
    return
  }
  existing.task = task
  existing.cwd = cwd
  if (watch !== undefined) existing.watches.push(watch)
}

/**
 * Register `code_agent`, `code_agent_status`, and `code_agent_stop` on the
 * calling Computer Use tool layer.
 * @param ctx - registration scope; `inject` must already be satisfied.
 */
export function apply(ctx: Context): void {
  const byCaller = new Map<SessionId, Map<SessionId, Delegation>>()
  const rememberedCallers = new WeakSet<Agent>()
  const unattended = new WeakSet<Agent>()

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
          'Existing standard session this Computer Use agent started. Omit to create a blank session. '
          + 'Required when following up on the same artifact; forbidden when starting unrelated work.',
      },
      cwd: {
        type: 'string',
        description:
          'Workspace directory for a newly created session. Pass a named path or <frontmost_folder>. '
          + 'Omit to create a new subdirectory under this Computer Use session\'s cwd.',
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
          ? `Started a new standard session ${value.session_id}. ${RUNNING_RESULT} Pass this session_id to continue the same artifact.`
          : `Queued on standard session ${value.session_id}. ${RUNNING_RESULT}`,
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
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      },
    }),
    async execute(args, exec) {
      const caller = requireAgent(exec)
      const task = args.task.trim()
      if (task === '') throw new Error('code_agent task must include non-whitespace text')
      if (args.session_id !== undefined && args.session_id.trim() === '') {
        throw new Error('code_agent session_id must be omitted or a non-empty id')
      }
      const delegations = callerDelegations(byCaller, caller.id)
      let sessionId: SessionId
      let created = false
      let cwd: string
      if (args.session_id === undefined) {
        const directory = args.cwd !== undefined
          ? args.cwd
          : caller.session.header.cwd === undefined
            ? undefined
            : uniqueDirectory(caller.session.header.cwd, slugFromTask(task))
        const location = args.cwd === undefined && directory !== undefined
          ? { cwd: directory }
          : await locationForCreate(ctx, directory)
        const createdSession = await ctx.sessionController.create({
          agentPreset: 'standard',
          ...location,
        })
        sessionId = createdSession.sessionId
        created = true
        cwd = directory ?? caller.session.header.cwd ?? ''
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
        const known = delegations.get(sessionId)
        if (known === undefined) {
          throw new Error(
            `code_agent can continue only a session this Computer Use agent started, not "${sessionId}"`,
          )
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
        cwd = header.cwd ?? known.cwd
      }
      const requestId = brandString<SessionRequestId>(`code-agent-${randomUUID()}`)
      await ctx.sessionController.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: queuedTaskText(task) }],
      }, exec.signal)
      const agents = ctx.get('agents')
      const liveCaller = agents?.get(caller.id)
      const code = agents?.get(sessionId)
      if (liveCaller !== undefined) {
        rememberCaller(liveCaller, caller.id, byCaller, rememberedCallers)
      }
      if (code !== undefined) attachUnattendedCodeAgent(code, unattended)
      let watch: AbortController | undefined
      if (agents !== undefined && liveCaller !== undefined && code !== undefined) {
        watch = watchCodeAgentCompletion({
          caller: liveCaller,
          code,
          agents,
          task,
          sessionId,
          requestId,
        })
      }
      recordDelegation(delegations, sessionId, task, cwd, watch)
      return { accepted: true, created, session_id: sessionId }
    },
  }))

  ctx.tools.register(defineTool({
    name: STATUS_TOOL_NAME,
    description: STATUS_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                session_id: { type: 'string', required: true },
                task: { type: 'string', required: true },
                cwd: { type: 'string', required: true },
                status: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? 'No background Code agent sessions from this Computer Use chat.'
          : value.tasks.map(entry => (
            `${entry.session_id}: ${entry.status} — ${entry.task} (${entry.cwd})`
          )).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: 'generic',
      title: 'Code agent status',
      kind: 'read',
    }),
    async execute(_args, exec) {
      const caller = requireAgent(exec)
      const agents = ctx.get('agents')
      const tasks = [...(byCaller.get(caller.id) ?? [])].map(([sessionId, entry]) => ({
        session_id: sessionId,
        task: entry.task,
        cwd: entry.cwd,
        status: agents?.get(sessionId)?.status === 'running' ? 'running' : 'idle',
      }))
      return { count: tasks.length, tasks }
    },
  }))

  ctx.tools.register(defineTool({
    name: STOP_TOOL_NAME,
    description: STOP_DESCRIPTION,
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description: 'Background Code agent session this Computer Use agent started. Required.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          session_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Stopped background Code agent session ${value.session_id}. `
          + 'The session is idle. Pass this session_id to code_agent to continue the same artifact.',
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      title: 'Stop Code agent',
      kind: 'execute',
      rawInput: { session_id: args.session_id },
    }),
    async execute(args, exec) {
      const caller = requireAgent(exec)
      const sessionIdText = args.session_id.trim()
      if (sessionIdText === '') {
        throw new Error('code_agent_stop session_id must be a non-empty id')
      }
      const sessionId = brandString<SessionId>(sessionIdText)
      const known = byCaller.get(caller.id)?.get(sessionId)
      if (known === undefined) {
        throw new Error(
          `code_agent_stop can stop only a session this Computer Use agent started, not "${sessionId}"`,
        )
      }
      for (const watch of known.watches.splice(0)) watch.abort()
      ctx.get('agents')?.get(sessionId)?.cancel({ kind: 'user' })
      return { accepted: true, session_id: sessionId }
    },
  }))
}
