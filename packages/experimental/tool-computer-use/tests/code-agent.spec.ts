import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject, name, TOOL_NAME } from '../src/code-agent.ts'
import { POLICY } from '../src/policy.ts'

const SIGNAL = new AbortController().signal
const CALLER = SessionId('cu-orb')
const STANDARD = SessionId('session-standard-1')
const STANDARD_B = SessionId('session-standard-2')

interface CreateRequest {
  readonly agentPreset?: string
  readonly cwd?: string
  readonly origin?: string
  readonly parentAgent?: unknown
}

interface PromptRequest {
  readonly sessionId: string
  readonly mode: string
  readonly content: readonly { type: string; text?: string }[]
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
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const created: CreateRequest[] = []
  const prompted: PromptRequest[] = []
  let nextId = options.createId ?? STANDARD
  const headers = new Map<string, HeaderFacts>(Object.entries(options.headers ?? {}))
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
    async prompt(request: PromptRequest) {
      prompted.push(request)
      return { accepted: true }
    },
    async inspect(sessionId: SessionId) {
      const meta = headers.get(sessionId)
      if (meta === undefined) throw new Error(`session "${sessionId}" not found`)
      return { meta }
    },
  })
  if (options.owned === true) {
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
  apply(ctx)
  return { ctx, created, prompted }
}

function execute(
  ctx: Context,
  args: Record<string, unknown>,
  agent: object | null = callerAgent(),
) {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: ToolCallId('code-agent-1'),
    name: TOOL_NAME,
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
    const { ctx, created, prompted } = await setup()
    const result = await execute(ctx, { task: 'Write a Word document' })
    expect(result.isError).toBe(false)
    expect(created).toEqual([{ agentPreset: 'standard', cwd: '/workspace' }])
    expect(created[0]).not.toHaveProperty('origin')
    expect(created[0]).not.toHaveProperty('parentAgent')
    expect(prompted[0]).toMatchObject({
      sessionId: STANDARD,
      mode: 'queue',
      content: [{ type: 'text', text: 'Write a Word document' }],
    })
    expect(result.value).toEqual({ accepted: true, created: true, session_id: STANDARD })
    expect(text(result)).toContain(STANDARD)
  })

  it('continues the same session when session_id is supplied', async () => {
    const { ctx, created, prompted } = await setup({
      headers: {
        [STANDARD]: { id: STANDARD, agentPreset: 'standard', cwd: '/workspace' },
      },
    })
    const result = await execute(ctx, {
      task: 'Make the Word font green',
      session_id: STANDARD,
    })
    expect(result.isError).toBe(false)
    expect(created).toEqual([])
    expect(prompted).toHaveLength(1)
    expect(prompted[0]?.sessionId).toBe(STANDARD)
    expect(result.value).toMatchObject({ created: false, session_id: STANDARD })
    expect(text(result)).toContain(STANDARD)
  })

  it('creates a different session when session_id is omitted after a prior task', async () => {
    const { ctx, prompted } = await setup()
    await execute(ctx, { task: 'Write a Word document' })
    await execute(ctx, { task: 'Make a gobang game' })
    expect(prompted.map(request => request.sessionId)).toEqual([STANDARD, STANDARD_B])
  })

  it('refuses this Computer Use session, subagent sessions, non-standard presets, and cwd conflicts', async () => {
    const { ctx } = await setup({
      headers: {
        [CALLER]: { id: CALLER, agentPreset: 'computer-use', cwd: '/workspace' },
        [SessionId('sub')]: { id: SessionId('sub'), origin: 'subagent', agentPreset: 'standard' },
        [SessionId('cu')]: { id: SessionId('cu'), agentPreset: 'computer-use' },
        [STANDARD]: { id: STANDARD, agentPreset: 'standard', cwd: '/docs' },
      },
    })
    const self = await execute(ctx, { task: 'no', session_id: CALLER })
    expect(self.isError).toBe(true)
    expect(text(self)).toContain('this Computer Use session')
    const sub = await execute(ctx, { task: 'no', session_id: 'sub' })
    expect(sub.isError).toBe(true)
    expect(text(sub)).toContain('subagent')
    const cu = await execute(ctx, { task: 'no', session_id: 'cu' })
    expect(cu.isError).toBe(true)
    expect(text(cu)).toContain('standard')
    const cwd = await execute(ctx, { task: 'no', session_id: STANDARD, cwd: '/other' })
    expect(cwd.isError).toBe(true)
    expect(text(cwd)).toContain('cwd')
  })

  it('refuses a runtime-owned subagent child without header origin', async () => {
    const child = SessionId('child')
    const { ctx } = await setup({
      owned: true,
      headers: {
        [child]: { id: child, agentPreset: 'standard', parentSession: CALLER },
      },
    })
    const result = await execute(ctx, { task: 'no', session_id: child })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('subagent')
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
        expect(request).toEqual({ agentPreset: 'standard', cwd: '/workspace' })
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

  it('names an unspecified preset as unknown', async () => {
    const { ctx } = await setup({
      headers: {
        [STANDARD]: { id: STANDARD, cwd: '/workspace' },
      },
    })
    const unknown = await execute(ctx, { task: 'no', session_id: STANDARD })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('unknown')
  })

  it('treats a parentSession as ordinary when agents cannot confirm ownership', async () => {
    const child = SessionId('plain-child')
    const { ctx, prompted } = await setup({
      headers: {
        [child]: { id: child, agentPreset: 'standard', parentSession: CALLER },
      },
    })
    const result = await execute(ctx, { task: 'continue', session_id: child })
    expect(result.isError).toBe(false)
    expect(prompted[0]?.sessionId).toBe(child)
  })

  it('pins GUI versus code_agent routing in policy and the tool description', async () => {
    const { ctx } = await setup()
    expect(POLICY).toContain('opening WeChat')
    expect(POLICY).toContain('clicking a button in Pages')
    expect(POLICY).toContain('writing a Word document')
    expect(POLICY).toContain("making that Word document's font green")
    expect(POLICY).toContain('making a gobang game')
    const schema = ctx.tools.schemas().find(entry => entry.name === TOOL_NAME)
    expect(schema?.description).toContain('Omit session_id')
    expect(schema?.description).toContain('Pass session_id')
    expect(schema?.description).toContain('Do not pass a previous id')
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
})
