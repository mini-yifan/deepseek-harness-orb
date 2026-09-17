import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject, name, slugFromTask, STATUS_TOOL_NAME, STOP_TOOL_NAME, TOOL_NAME, uniqueDirectory } from '../src/code-agent.ts'
import {
  COMPLETION_BODY_MAX_CHARS,
  COMPLETION_PLUGIN,
  watchCodeAgentCompletion,
} from '../src/code-agent-completion.ts'
import { autoAnswerQuestions, UNATTENDED_CUSTOM_ANSWER } from '../src/code-agent-unattended.ts'
import { POLICY } from '../src/policy.ts'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'

const SIGNAL = new AbortController().signal
const CALLER = SessionId('cu-orb')
const CALLER_B = SessionId('cu-orb-b')
const STANDARD = SessionId('session-standard-1')
const STANDARD_B = SessionId('session-standard-2')

function autoCwd(task: string, parent = '/workspace'): string {
  return uniqueDirectory(parent, slugFromTask(task))
}

interface CreateRequest {
  readonly agentPreset?: string
  readonly cwd?: string
  readonly workspaceId?: string
  readonly origin?: string
  readonly parentAgent?: unknown
}

interface SelectModelRequest {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly saveAsDefault?: boolean
}

interface PromptRequest {
  readonly requestId?: string
  readonly sessionId: string
  readonly mode: string
  readonly content: readonly { type: string; text?: string }[]
}

interface FakeMessage {
  readonly role: string
  readonly content: { type: string; text?: string }[]
}

interface FakeAgent {
  readonly id: SessionId
  status: 'idle' | 'running'
  readonly inbox: { nextTurn: UserMessage[]; nextStep: UserMessage[] }
  readonly followups: UserMessage[]
  readonly warnings: string[]
  readonly whenIdleCalls: number
  readonly statusSubscriptions: number
  readonly cancelCalls: Array<{ cause: unknown; options?: { keepInbox?: boolean } }>
  readonly session: { deriveMessages(): FakeMessage[] }
  whenIdle(): Promise<void>
  followup(message: UserMessage): void
  cancel(cause: unknown, options?: { keepInbox?: boolean }): void
  emitWaterfall(event: string, payload: unknown): Promise<unknown>
  readonly ctx: {
    logger: { warn(message?: string): void }
    effect(callback: () => (() => undefined) | undefined): () => undefined
    on(
      event: string,
      handler: (payload?: unknown, next?: () => Promise<unknown>) => unknown,
      options?: { prepend?: boolean },
    ): () => void
  }
  setRunning(): void
  resolveIdle(): void
  emitStatus(): void
  dispose(): void
}

function createFakeAgent(id: SessionId, options: {
  readonly status?: 'idle' | 'running'
  readonly assistant?: string
  readonly messages?: FakeMessage[]
  readonly effectMode?: 'register' | 'throw' | 'abort-immediately'
  readonly followupError?: Error
  readonly warnError?: Error
  readonly deriveError?: Error
  readonly onDerive?: () => void
  readonly syncClaimOnStatusSubscribe?: boolean
} = {}): FakeAgent {
  let status: 'idle' | 'running' = options.status ?? 'idle'
  let idle = Promise.withResolvers<undefined>()
  if (status === 'idle') idle.resolve(undefined)
  const statusListeners = new Set<(payload: { status: 'idle' | 'running' }) => void>()
  const disposedListeners = new Set<() => void>()
  const effects: Array<() => void> = []
  const followups: UserMessage[] = []
  const warnings: string[] = []
  const inbox = { nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[] }
  let whenIdleCalls = 0
  let statusSubscriptions = 0
  const extra = new Map<string, Array<(payload?: unknown, next?: () => Promise<unknown>) => unknown>>()
  const cancelCalls: Array<{ cause: unknown; options?: { keepInbox?: boolean } }> = []
  const fake: FakeAgent = {
    id,
    get status() {
      return status
    },
    set status(next) {
      status = next
    },
    inbox,
    followups,
    warnings,
    get whenIdleCalls() {
      return whenIdleCalls
    },
    get statusSubscriptions() {
      return statusSubscriptions
    },
    cancelCalls,
    session: {
      deriveMessages() {
        options.onDerive?.()
        if (options.deriveError !== undefined) throw options.deriveError
        if (options.messages !== undefined) return options.messages
        if (options.assistant === undefined) return []
        return [{ role: 'assistant', content: [{ type: 'text', text: options.assistant }] }]
      },
    },
    whenIdle() {
      whenIdleCalls += 1
      return idle.promise
    },
    followup(message) {
      if (options.followupError !== undefined) throw options.followupError
      followups.push(message)
    },
    cancel(cause, cancelOptions) {
      if (cancelOptions === undefined) cancelCalls.push({ cause })
      else cancelCalls.push({ cause, options: cancelOptions })
      if (cancelOptions?.keepInbox !== true) {
        inbox.nextTurn.length = 0
        inbox.nextStep.length = 0
      }
      if (status !== 'idle') fake.resolveIdle()
    },
    async emitWaterfall(event, payload) {
      const handlers = extra.get(event) ?? []
      let index = 0
      const next = async (): Promise<unknown> => {
        const handler = handlers[index]
        index += 1
        if (handler === undefined) throw new Error(`no ${event} handler`)
        return handler(payload, next)
      }
      return next()
    },
    ctx: {
      logger: {
        warn(message) {
          warnings.push(String(message))
          if (options.warnError !== undefined) throw options.warnError
        },
      },
      effect(callback) {
        if (options.effectMode === 'throw') throw new Error('agent context disposed')
        const dispose = callback()
        if (typeof dispose === 'function') effects.push(dispose)
        if (options.effectMode === 'abort-immediately') dispose?.()
        return () => {
          dispose?.()
        }
      },
      on(event, handler, eventOptions) {
        if (event === 'agent/status') {
          const wrapped = (payload: { status: 'idle' | 'running' }): void => {
            handler(payload)
          }
          statusListeners.add(wrapped)
          statusSubscriptions += 1
          if (options.syncClaimOnStatusSubscribe === true) {
            inbox.nextTurn.length = 0
            inbox.nextStep.length = 0
            wrapped({ status })
          }
          return () => {
            statusListeners.delete(wrapped)
          }
        }
        if (event === 'agent/disposed') {
          const wrapped = (): void => {
            handler()
          }
          disposedListeners.add(wrapped)
          return () => {
            disposedListeners.delete(wrapped)
          }
        }
        const list = extra.get(event) ?? []
        if (eventOptions?.prepend === true) list.unshift(handler)
        else list.push(handler)
        extra.set(event, list)
        return () => {
          extra.set(event, (extra.get(event) ?? []).filter(entry => entry !== handler))
        }
      },
    },
    setRunning() {
      status = 'running'
      idle = Promise.withResolvers<undefined>()
      for (const listener of statusListeners) listener({ status })
    },
    resolveIdle() {
      status = 'idle'
      idle.resolve(undefined)
      for (const listener of statusListeners) listener({ status })
    },
    emitStatus() {
      for (const listener of statusListeners) listener({ status })
    },
    dispose() {
      for (const dispose of effects.splice(0)) dispose()
      for (const listener of disposedListeners) listener()
    },
  }
  return fake
}

interface HeaderFacts {
  readonly id: SessionId
  readonly origin?: 'subagent'
  readonly agentPreset?: string
  readonly cwd?: string
  readonly parentSession?: SessionId
}

function callerAgent(header: Partial<HeaderFacts> = {}) {
  return {
    id: CALLER,
    session: {
      header: {
        id: CALLER,
        agentPreset: 'computer-use',
        cwd: '/workspace',
        ...header,
      },
    },
  }
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(options: {
  readonly headers?: Record<string, HeaderFacts>
  readonly createId?: SessionId
  readonly owned?: boolean
  readonly workspaceId?: string
  readonly workspace?: 'miss' | 'throw' | 'invalid'
  readonly live?: Map<SessionId, FakeAgent>
  readonly withoutInitiatorThrows?: boolean
  readonly orbModel?: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const created: CreateRequest[] = []
  const prompted: PromptRequest[] = []
  const selected: SelectModelRequest[] = []
  const operations: string[] = []
  let nextId = options.createId ?? STANDARD
  const headers = new Map<string, HeaderFacts>(Object.entries(options.headers ?? {}))
  const live = options.live
  let agentsGetCalls = 0
  ctx.provide('sessionController', {
    async create(request: CreateRequest) {
      created.push(request)
      const id = nextId
      if (nextId === STANDARD) nextId = STANDARD_B
      headers.set(id, {
        id,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      })
      return { sessionId: id, agentPreset: request.agentPreset }
    },
    async selectModel(request: SelectModelRequest) {
      operations.push('selectModel')
      selected.push(request)
    },
    async prompt(request: PromptRequest) {
      operations.push('prompt')
      prompted.push(request)
      const code = live?.get(SessionId(request.sessionId))
      if (code !== undefined && request.requestId !== undefined) {
        code.inbox.nextTurn.push(createUserMessage({
          content: request.content as never,
          source: { kind: 'user', rpcId: request.requestId },
        }))
      }
      return { accepted: true }
    },
    async inspect(sessionId: SessionId) {
      const meta = headers.get(sessionId)
      if (meta === undefined) throw new Error(`session "${sessionId}" not found`)
      return { meta }
    },
  })
  if (live !== undefined) {
    ctx.provide('agents', {
      get(id: SessionId) {
        agentsGetCalls += 1
        return live.get(id) as Agent | undefined
      },
      withoutInitiator<T>(operation: () => T) {
        if (options.withoutInitiatorThrows === true) throw new Error('initiator scope closing')
        return operation()
      },
      isOwnedBy() {
        return false
      },
    })
  } else if (options.owned === true) {
    const parent = { id: CALLER }
    const child = { id: SessionId('child') }
    ctx.provide('agents', {
      get(id: SessionId) {
        if (id === child.id) return child
        if (id === CALLER) return parent
        return undefined
      },
      isOwnedBy(agentId: SessionId, owner: { id: SessionId }) {
        return agentId === child.id && owner.id === CALLER
      },
    })
  }
  if (options.workspaceId !== undefined) {
    const workspaceId = options.workspaceId
    ctx.provide('workspaceRegistry', {
      async resolveByPath() {
        return { id: workspaceId }
      },
    })
  } else if (options.workspace === 'miss') {
    ctx.provide('workspaceRegistry', {
      async resolveByPath() {
        return undefined
      },
    })
  } else if (options.workspace === 'throw') {
    ctx.provide('workspaceRegistry', {
      async resolveByPath() {
        throw new Error('workspace lookup failed')
      },
    })
  } else if (options.workspace === 'invalid') {
    ctx.provide('workspaceRegistry', {})
  }
  if (options.orbModel !== undefined) {
    const orbModel = options.orbModel
    ctx.provide('orbCodeAgentModel', {
      currentSelection: () => orbModel,
    })
  }
  apply(ctx)
  return { ctx, created, prompted, selected, operations, get agentsGetCalls() { return agentsGetCalls } }
}

function execute(
  ctx: Context,
  args: Record<string, unknown>,
  agent: object | null = callerAgent(),
  toolName: string = TOOL_NAME,
) {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: ToolCallId('code-agent-1'),
    name: toolName,
    arguments: args,
    ...(agent === null ? {} : { agent: agent as never }),
  })
}

describe('code_agent plugin', () => {
  it('exports loader identity without a default export', async () => {
    expect(name).toBe('tool-code-agent')
    expect(inject).toEqual(['tools', 'sessionController'])
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin({ name, inject, apply })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  })

  it('creates a standard session without subagent origin and queues the task', async () => {
    const { ctx, created, prompted, selected } = await setup()
    const result = await execute(ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    expect(created).toEqual([{ agentPreset: 'standard', cwd: autoCwd('Write a Word document') }])
    expect(selected).toEqual([])
    expect(created[0]).not.toHaveProperty('origin')
    expect(created[0]).not.toHaveProperty('parentAgent')
    expect(prompted[0]).toMatchObject({
      sessionId: STANDARD,
      mode: 'queue',
      content: [{ type: 'text', text: 'Write a Word document' }],
    })
    expect(result.value).toEqual({ accepted: true, created: true, session_id: STANDARD })
    expect(text(result)).toContain(STANDARD)
    expect(text(result)).toContain('Tell the user the background Code agent is running')
  })

  it('selects the stored background model before queueing a newly created session', async () => {
    const { ctx, selected, operations } = await setup({
      orbModel: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    })
    const result = await execute(ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    expect(selected).toEqual([{
      sessionId: STANDARD,
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      saveAsDefault: false,
    }])
    expect(operations).toEqual(['selectModel', 'prompt'])
  })

  it('does not select a model when continuing an existing session', async () => {
    const { ctx, created, selected, operations } = await setup({
      orbModel: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    })
    await execute(ctx, { task: 'Write a Word document' })
    const result = await execute(ctx, {
      task: 'Make the Word font green',
      session_id: STANDARD,
    })
    expect(result.isError).toBe(false)
    expect(created).toHaveLength(1)
    expect(selected).toEqual([{
      sessionId: STANDARD,
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      saveAsDefault: false,
    }])
    expect(operations).toEqual(['selectModel', 'prompt', 'prompt'])
  })

  it('creates with workspaceId when an explicit cwd matches a workspace', async () => {
    const { ctx, created } = await setup({ workspaceId: 'ws-orb' })
    const result = await execute(ctx, { task: 'Write a Word document', cwd: '/workspace' })
    expect(result.isError).toBe(false)
    expect(created).toEqual([{ agentPreset: 'standard', workspaceId: 'ws-orb' }])
  })

  it('omits workspaceId when minting a subdirectory even if the parent workspace resolves', async () => {
    const { ctx, created } = await setup({ workspaceId: 'ws-orb' })
    const result = await execute(ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    expect(created).toEqual([{ agentPreset: 'standard', cwd: autoCwd('Write a Word document') }])
  })

  it('falls back to cwd when workspace lookup misses, throws, or is not a resolver', async () => {
    const miss = await setup({ workspace: 'miss' })
    await execute(miss.ctx, { task: 'Write a Word document', cwd: '/docs' })
    expect(miss.created).toEqual([{ agentPreset: 'standard', cwd: '/docs' }])
    const boom = await setup({ workspace: 'throw' })
    await execute(boom.ctx, { task: 'Write a Word document', cwd: '/docs' })
    expect(boom.created).toEqual([{ agentPreset: 'standard', cwd: '/docs' }])
    const invalid = await setup({ workspace: 'invalid' })
    await execute(invalid.ctx, { task: 'Write a Word document', cwd: '/docs' })
    expect(invalid.created).toEqual([{ agentPreset: 'standard', cwd: '/docs' }])
  })

  it('continues the same session when session_id is supplied', async () => {
    const { ctx, created, prompted } = await setup()
    await execute(ctx, { task: 'Write a Word document' })
    const result = await execute(ctx, {
      task: 'Make the Word font green',
      session_id: STANDARD,
    })
    expect(result.isError).toBe(false)
    expect(created).toHaveLength(1)
    expect(prompted).toHaveLength(2)
    expect(prompted[1]?.sessionId).toBe(STANDARD)
    expect(result.value).toMatchObject({ created: false, session_id: STANDARD })
    expect(text(result)).toContain(STANDARD)
  })

  it('creates a different session when session_id is omitted after a prior task', async () => {
    const { ctx, prompted } = await setup()
    await execute(ctx, { task: 'Write a Word document' })
    await execute(ctx, { task: 'Make a gobang game' })
    expect(prompted.map(request => request.sessionId)).toEqual([STANDARD, STANDARD_B])
  })

  it('refuses this Computer Use session, unregistered sessions, and cwd conflicts', async () => {
    const { ctx } = await setup()
    const self = await execute(ctx, { task: 'no', session_id: CALLER })
    expect(self.isError).toBe(true)
    expect(text(self)).toContain('this Computer Use session')
    const foreign = await execute(ctx, { task: 'no', session_id: STANDARD })
    expect(foreign.isError).toBe(true)
    expect(text(foreign)).toContain('this Computer Use agent started')
    await execute(ctx, { task: 'Write a Word document', cwd: '/docs' })
    const cwd = await execute(ctx, { task: 'no', session_id: STANDARD, cwd: '/other' })
    expect(cwd.isError).toBe(true)
    expect(text(cwd)).toContain('cwd')
  })

  it('refuses a blank task, blank session_id, missing caller, and unknown session', async () => {
    const { ctx } = await setup()
    const blank = await execute(ctx, { task: '   ' })
    expect(blank.isError).toBe(true)
    const emptyId = await execute(ctx, { task: 'work', session_id: '  ' })
    expect(emptyId.isError).toBe(true)
    const missing = await execute(ctx, { task: 'work' }, null)
    expect(missing.isError).toBe(true)
    const unknown = await execute(ctx, { task: 'work', session_id: 'missing' })
    expect(unknown.isError).toBe(true)
  })

  it('queues the same user/message event a sidebar session would receive', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const sessions = new Map<string, Session>()
    let created = 0
    ctx.provide('sessionController', {
      async create(request: CreateRequest) {
        expect(request).toEqual({
          agentPreset: 'standard',
          cwd: created === 0 ? autoCwd('Write a Word document') : autoCwd('Make a gobang game'),
        })
        const id = created === 0 ? STANDARD : STANDARD_B
        created += 1
        sessions.set(id, Session.create(id))
        return { sessionId: id, agentPreset: 'standard' }
      },
      async prompt(request: PromptRequest) {
        const session = sessions.get(request.sessionId)
        if (session === undefined) throw new Error('missing session')
        session.append('user/message', createUserMessage({
          content: request.content as never,
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        return { accepted: true }
      },
      async inspect(sessionId: SessionId) {
        const session = sessions.get(sessionId)
        if (session === undefined) throw new Error(`session "${sessionId}" not found`)
        return { meta: { ...session.header, agentPreset: 'standard' } }
      },
    })
    apply(ctx)
    await execute(ctx, { task: 'Write a Word document' })
    await execute(ctx, { task: 'Make the Word font green', session_id: STANDARD })
    await execute(ctx, { task: 'Make a gobang game' })
    const word = sessions.get(STANDARD)?.snapshotEvents().filter(event => event.type === 'user/message')
    const game = sessions.get(STANDARD_B)?.snapshotEvents().filter(event => event.type === 'user/message')
    expect(word).toHaveLength(2)
    expect(game).toHaveLength(1)
  })

  it('uses an explicit cwd and omits caller cwd on create', async () => {
    const explicit = await setup()
    await execute(explicit.ctx, { task: 'Write a Word document', cwd: '/docs' })
    expect(explicit.created[0]?.cwd).toBe('/docs')
    const omitted = await setup()
    await execute(omitted.ctx, { task: 'Write a Word document' }, {
      id: CALLER,
      session: { header: { id: CALLER, agentPreset: 'computer-use' } },
    })
    expect(omitted.created).toEqual([{ agentPreset: 'standard' }])
  })

  it('pins GUI versus code_agent routing in policy and the tool description', async () => {
    const { ctx } = await setup()
    expect(POLICY).toContain('opening WeChat')
    expect(POLICY).toContain('clicking a button in Pages')
    expect(POLICY).toContain('writing a Word document')
    expect(POLICY).toContain("making that Word document's font green")
    expect(POLICY).toContain('making a gobang game')
    expect(POLICY).toContain('tell the user the background Code agent is running')
    expect(POLICY).toContain('Do not call wait, long_wait, or bash sleep')
    expect(POLICY).toContain('today\'s weather')
    expect(POLICY).toContain('research report')
    expect(POLICY).toContain('write the report as HTML')
    expect(POLICY).toContain('<frontmost_folder> is absent')
    expect(POLICY).toContain('Do not guess')
    expect(POLICY).toContain('code_agent_status')
    expect(POLICY).toContain('code_agent_stop')
    expect(POLICY).toContain('plugin notice')
    const schema = ctx.tools.schemas().find(entry => entry.name === TOOL_NAME)
    expect(schema?.description).toContain('Omit session_id')
    expect(schema?.description).toContain('Pass session_id')
    expect(schema?.description).toContain('Do not pass a previous id')
    expect(schema?.description).toContain('Do not call wait, long_wait, or bash sleep')
    expect(schema?.description).toContain('plugin notice')
    expect(ctx.tools.get(TOOL_NAME)?.presentCall?.({ task: 'Write a Word document' })).toMatchObject({
      card: 'generic',
      title: 'Code agent',
      rawInput: { task: 'Write a Word document' },
    })
    expect(ctx.tools.get(TOOL_NAME)?.presentCall?.({
      task: 'Make the Word font green',
      session_id: STANDARD,
    })).toMatchObject({
      card: 'generic',
      rawInput: {
        task: 'Make the Word font green',
        session_id: STANDARD,
      },
    })
    expect(ctx.tools.executionMode({
      signal: SIGNAL,
      callId: ToolCallId('code-agent-1'),
      name: TOOL_NAME,
      arguments: { task: 'Write a Word document' },
    })).toEqual({ kind: 'parallel' })
  })

  it('returns before the Code session is idle', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    const result = await execute(ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    expect(caller.followups).toEqual([])
    code.resolveIdle()
    await expect.poll(() => caller.followups.length).toBe(1)
    expect(caller.followups[0]?.source).toMatchObject({
      kind: 'plugin',
      plugin: COMPLETION_PLUGIN,
      form: 'notice',
    })
    expect(text({ content: caller.followups[0]!.content })).toContain('Wrote the Word document.')
    expect(text({ content: caller.followups[0]!.content })).toContain('Write a Word document')
  })

  it('parks the notice until the Computer Use caller is idle', async () => {
    const caller = createFakeAgent(CALLER, { status: 'running' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    await execute(ctx, { task: 'Write a Word document' })
    code.resolveIdle()
    await expect.poll(() => caller.whenIdleCalls).toBeGreaterThan(0)
    expect(caller.followups).toEqual([])
    caller.resolveIdle()
    await expect.poll(() => caller.followups.length).toBe(1)
    expect(text({ content: caller.followups[0]!.content })).toContain('Wrote the Word document.')
  })

  it('does not deliver while the Code session is still idle with the prompt unclaimed', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'idle', assistant: 'Wrote the Word document.' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    await execute(ctx, { task: 'Write a Word document' })
    await expect.poll(() => code.statusSubscriptions).toBeGreaterThan(0)
    code.emitStatus()
    expect(caller.followups).toEqual([])
    const queued = code.inbox.nextTurn.splice(0)
    code.inbox.nextTurn.push(createUserMessage({
      content: [{ type: 'text', text: 'other' }],
      source: { kind: 'user' },
    }))
    code.inbox.nextStep.push(...queued)
    code.emitStatus()
    expect(caller.followups).toEqual([])
    code.setRunning()
    code.resolveIdle()
    await expect.poll(() => caller.followups.length).toBe(1)
  })

  it('drops the notice when the Computer Use caller is disposed', async () => {
    const caller = createFakeAgent(CALLER, { status: 'running' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const harness = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    const result = await execute(harness.ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    await expect.poll(() => code.whenIdleCalls).toBeGreaterThan(0)
    const gets = harness.agentsGetCalls
    caller.dispose()
    code.resolveIdle()
    caller.resolveIdle()
    expect(caller.whenIdleCalls).toBe(0)
    expect(harness.agentsGetCalls).toBe(gets)
    expect(caller.followups).toEqual([])

    const parked = createFakeAgent(CALLER, { status: 'running' })
    const running = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const second = await setup({ live: new Map([[CALLER, parked], [STANDARD, running]]) })
    await execute(second.ctx, { task: 'Write a Word document' })
    running.resolveIdle()
    await expect.poll(() => parked.whenIdleCalls).toBeGreaterThan(0)
    parked.dispose()
    parked.resolveIdle()
    expect(parked.followups).toEqual([])
  })

  it('skips the watch when the live Code agent is missing and does not followup a replacement caller', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller]]) })
    const missing = await execute(ctx, { task: 'Write a Word document' })
    expect(missing.isError).toBe(false)
    expect(caller.followups).toEqual([])

    const original = createFakeAgent(CALLER, { status: 'running' })
    const replacement = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const live = new Map([[CALLER, original], [STANDARD, code]])
    const second = await setup({ live })
    const queued = await execute(second.ctx, { task: 'Write a Word document' })
    expect(queued.isError).toBe(false)
    live.set(CALLER, replacement)
    code.resolveIdle()
    await expect.poll(() => original.whenIdleCalls).toBeGreaterThan(0)
    const gets = second.agentsGetCalls
    original.resolveIdle()
    await expect.poll(() => second.agentsGetCalls).toBeGreaterThan(gets)
    expect(original.followups).toEqual([])
    expect(replacement.followups).toEqual([])
  })

  it('uses fallback text when there is no assistant message and truncates a long outcome', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const silent = createFakeAgent(STANDARD, {
      status: 'running',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Write a Word document' }] },
        { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
      ],
    })
    const first = await setup({ live: new Map([[CALLER, caller], [STANDARD, silent]]) })
    await execute(first.ctx, { task: 'Write a Word document' })
    silent.resolveIdle()
    await expect.poll(() => caller.followups.length).toBe(1)
    expect(text({ content: caller.followups[0]!.content })).toContain(
      'The Code agent session ended without a final assistant message.',
    )

    const longCaller = createFakeAgent(CALLER, { status: 'idle' })
    const longCode = createFakeAgent(STANDARD, {
      status: 'running',
      assistant: 'y'.repeat(COMPLETION_BODY_MAX_CHARS),
    })
    const second = await setup({ live: new Map([[CALLER, longCaller], [STANDARD, longCode]]) })
    await execute(second.ctx, { task: 'Write a Word document' })
    longCode.resolveIdle()
    await expect.poll(() => longCaller.followups.length).toBe(1)
    const body = text({ content: longCaller.followups[0]!.content })
    expect(body).toHaveLength(COMPLETION_BODY_MAX_CHARS)
    expect(body.endsWith('…')).toBe(true)
  })

  it('delivers after Code dispose and after subscribe observes a claimed prompt', async () => {
    const disposedCaller = createFakeAgent(CALLER, { status: 'idle' })
    const disposedCode = createFakeAgent(STANDARD, { status: 'idle', assistant: 'Stopped.' })
    const first = await setup({ live: new Map([[CALLER, disposedCaller], [STANDARD, disposedCode]]) })
    await execute(first.ctx, { task: 'Write a Word document' })
    await expect.poll(() => disposedCode.statusSubscriptions).toBeGreaterThan(0)
    disposedCode.dispose()
    await expect.poll(() => disposedCaller.followups.length).toBe(1)
    expect(text({ content: disposedCaller.followups[0]!.content })).toContain('Stopped.')

    const claimedCaller = createFakeAgent(CALLER, { status: 'idle' })
    const claimedCode = createFakeAgent(STANDARD, {
      status: 'idle',
      assistant: 'Already done.',
      syncClaimOnStatusSubscribe: true,
    })
    const second = await setup({ live: new Map([[CALLER, claimedCaller], [STANDARD, claimedCode]]) })
    await execute(second.ctx, { task: 'Write a Word document' })
    await expect.poll(() => claimedCaller.followups.length).toBe(1)
    expect(text({ content: claimedCaller.followups[0]!.content })).toContain('Already done.')
  })

  it('contains watch failures and drops the watch when the caller cannot own it', async () => {
    const failingCaller = createFakeAgent(CALLER, {
      status: 'idle',
      followupError: new Error('delivery failed'),
      warnError: new Error('logger gone'),
    })
    const failingCode = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const failing = await setup({ live: new Map([[CALLER, failingCaller], [STANDARD, failingCode]]) })
    const delivered = await execute(failing.ctx, { task: 'Write a Word document' })
    expect(delivered.isError).toBe(false)
    failingCode.resolveIdle()
    await expect.poll(() => failingCaller.warnings.length).toBeGreaterThan(0)
    expect(failingCaller.followups).toEqual([])

    const snapshotCaller = createFakeAgent(CALLER, { status: 'idle' })
    const snapshotCode = createFakeAgent(STANDARD, {
      status: 'running',
      deriveError: new Error('snapshot failed'),
    })
    const snapshot = await setup({ live: new Map([[CALLER, snapshotCaller], [STANDARD, snapshotCode]]) })
    await execute(snapshot.ctx, { task: 'Write a Word document' })
    snapshotCode.resolveIdle()
    await expect.poll(() => snapshotCaller.warnings.length).toBeGreaterThan(0)

    let abortedDerive = false
    const abortingCaller = createFakeAgent(CALLER, { status: 'idle' })
    const abortingCode = createFakeAgent(STANDARD, {
      status: 'running',
      onDerive() {
        abortingCaller.dispose()
        abortedDerive = true
      },
      deriveError: new Error('snapshot failed'),
    })
    const aborting = await setup({ live: new Map([[CALLER, abortingCaller], [STANDARD, abortingCode]]) })
    await execute(aborting.ctx, { task: 'Write a Word document' })
    abortingCode.resolveIdle()
    await expect.poll(() => abortedDerive).toBe(true)
    expect(abortingCaller.warnings).toEqual([])
    expect(abortingCaller.followups).toEqual([])

    const disposedCaller = createFakeAgent(CALLER, { status: 'idle', effectMode: 'throw' })
    const disposedCode = createFakeAgent(STANDARD, { status: 'running' })
    const disposed = await setup({ live: new Map([[CALLER, disposedCaller], [STANDARD, disposedCode]]) })
    const skipped = await execute(disposed.ctx, { task: 'Write a Word document' })
    expect(skipped.isError).toBe(false)
    disposedCode.resolveIdle()
    expect(disposedCaller.followups).toEqual([])

    const abortedCaller = createFakeAgent(CALLER, { status: 'idle', effectMode: 'abort-immediately' })
    const abortedCode = createFakeAgent(STANDARD, { status: 'idle', assistant: 'Wrote the Word document.' })
    const aborted = await setup({ live: new Map([[CALLER, abortedCaller], [STANDARD, abortedCode]]) })
    const cancelled = await execute(aborted.ctx, { task: 'Write a Word document' })
    expect(cancelled.isError).toBe(false)
    expect(abortedCode.statusSubscriptions).toBe(0)
    abortedCode.setRunning()
    abortedCode.resolveIdle()
    expect(abortedCaller.followups).toEqual([])

    const closingCaller = createFakeAgent(CALLER, { status: 'idle' })
    const closingCode = createFakeAgent(STANDARD, { status: 'running' })
    const closing = await setup({
      live: new Map([[CALLER, closingCaller], [STANDARD, closingCode]]),
      withoutInitiatorThrows: true,
    })
    const closed = await execute(closing.ctx, { task: 'Write a Word document' })
    expect(closed.isError).toBe(false)
    closingCode.resolveIdle()
    expect(closingCaller.followups).toEqual([])
  })

  it('does not start a watch from a disposed caller helper', () => {
    const caller = createFakeAgent(CALLER, { status: 'idle', effectMode: 'throw' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    expect(() => {
      watchCodeAgentCompletion({
        caller: caller as never,
        code: code as never,
        agents: {
          get: () => caller as never,
          withoutInitiator(operation) {
            return operation()
          },
        },
        task: 'Write a Word document',
        sessionId: STANDARD,
        requestId: 'code-agent-direct' as never,
      })
    }).not.toThrow()
    expect(caller.followups).toEqual([])
  })

  it('lists only this caller\'s sessions and reports running or idle', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const other = createFakeAgent(CALLER_B, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running' })
    const second = createFakeAgent(STANDARD_B, { status: 'idle' })
    const { ctx } = await setup({
      live: new Map([
        [CALLER, caller],
        [CALLER_B, other],
        [STANDARD, code],
        [STANDARD_B, second],
      ]),
    })
    const empty = await execute(ctx, {}, callerAgent(), STATUS_TOOL_NAME)
    expect(empty.value).toEqual({ count: 0, tasks: [] })
    await execute(ctx, { task: 'Write a Word document' })
    await execute(ctx, { task: 'Make a gobang game' })
    const listed = await execute(ctx, {}, callerAgent(), STATUS_TOOL_NAME)
    expect(listed.isError).toBe(false)
    expect(listed.value).toEqual({
      count: 2,
      tasks: [
        {
          session_id: STANDARD,
          task: 'Write a Word document',
          cwd: autoCwd('Write a Word document'),
          status: 'running',
        },
        {
          session_id: STANDARD_B,
          task: 'Make a gobang game',
          cwd: autoCwd('Make a gobang game'),
          status: 'idle',
        },
      ],
    })
    const hidden = await execute(ctx, {}, {
      id: CALLER_B,
      session: { header: { id: CALLER_B, agentPreset: 'computer-use', cwd: '/workspace' } },
    }, STATUS_TOOL_NAME)
    expect(hidden.value).toEqual({ count: 0, tasks: [] })
  })

  it('stops the running turn and queued follow-ups without deleting the session', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const { ctx, prompted } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    await execute(ctx, { task: 'Write a Word document' })
    await execute(ctx, { task: 'Make the font green', session_id: STANDARD })
    expect(code.inbox.nextTurn).toHaveLength(2)
    const stopped = await execute(ctx, { session_id: STANDARD }, callerAgent(), STOP_TOOL_NAME)
    expect(stopped.isError).toBe(false)
    expect(stopped.value).toEqual({ accepted: true, session_id: STANDARD })
    expect(code.cancelCalls).toEqual([{ cause: { kind: 'user' } }])
    expect(code.inbox.nextTurn).toEqual([])
    expect(code.status).toBe('idle')
    expect(caller.followups).toEqual([])
    const continued = await execute(ctx, { task: 'Make the pieces green and white', session_id: STANDARD })
    expect(continued.isError).toBe(false)
    expect(prompted).toHaveLength(3)
    const foreign = await execute(ctx, { session_id: STANDARD_B }, callerAgent(), STOP_TOOL_NAME)
    expect(foreign.isError).toBe(true)
    expect(text(foreign)).toContain('this Computer Use agent started')
  })

  it('does not deliver a completion notice after stop', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running', assistant: 'Wrote the Word document.' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    await execute(ctx, { task: 'Write a Word document' })
    await expect.poll(() => code.whenIdleCalls).toBeGreaterThan(0)
    await execute(ctx, { session_id: STANDARD }, callerAgent(), STOP_TOOL_NAME)
    expect(caller.followups).toEqual([])
  })

  it('auto-allows approval and auto-answers ask_user on the Code agent', async () => {
    const caller = createFakeAgent(CALLER, { status: 'idle' })
    const code = createFakeAgent(STANDARD, { status: 'running' })
    const { ctx } = await setup({ live: new Map([[CALLER, caller], [STANDARD, code]]) })
    await execute(ctx, { task: 'Write a Word document' })
    await expect(code.emitWaterfall('approval/request', { toolName: 'bash' })).resolves.toBe('allowed-once')
    await expect(code.emitWaterfall('user-questions/request', {
      questions: [{
        id: 'q1',
        question: 'Which color?',
        options: [{ label: 'Green (Recommended)' }, { label: 'Blue' }],
      }],
    })).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['Green (Recommended)'] }],
    })
  })

  it('picks recommended, first, plan-review, and free-text answers for unattended questions', () => {
    expect(autoAnswerQuestions([
      {
        id: 'plan',
        question: 'Ship this plan?',
        options: [{ label: 'Approve' }, { label: 'Reject' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      },
      {
        id: 'rec',
        question: 'Color?',
        options: [{ label: 'Red' }, { label: 'Green (Recommended)' }],
      },
      {
        id: 'first',
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
      },
      {
        id: 'all',
        question: 'Pick many',
        options: [{ label: 'A' }, { label: 'B' }],
        multiSelect: true,
      },
      { id: 'free', question: 'Anything else?' },
    ])).toEqual({
      answers: [
        { id: 'plan', selected: ['Approve'] },
        { id: 'rec', selected: ['Green (Recommended)'] },
        { id: 'first', selected: ['A'] },
        { id: 'all', selected: ['A', 'B'] },
        { id: 'free', selected: [], custom: UNATTENDED_CUSTOM_ANSWER },
      ],
    })
  })
})
