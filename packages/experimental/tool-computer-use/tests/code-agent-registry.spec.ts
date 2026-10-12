import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { apply, CODE_AGENT_REGISTRY, createCodeAgentRegistry, sharedCodeAgentRegistry } from '../src/code-agent-registry.ts'

type Listener = (payload?: unknown, event?: unknown) => void

interface FakeAgent {
  status: 'idle' | 'running'
  inbox: { nextTurn: unknown[]; nextStep: unknown[] }
  readonly sessionId: SessionId
  session: {
    deriveMessages(): readonly { role: string; content: readonly { type: string; text?: string }[] }[]
  }
  ctx: { on(event: string, listener: Listener): () => void }
  emit(event: string): void
  emitTurnEnd(reason: unknown): void
  setRunning(running: boolean): void
  reply(text: string): void
  dispose(): void
}

/** The registry only touches status, inbox, messages, session events, and the two agent events. */
function fakeAgent(sessionId: SessionId): FakeAgent {
  const listeners = new Map<string, Set<Listener>>()
  const messages: { role: string; content: { type: string; text?: string }[] }[] = []
  const agent: FakeAgent = {
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
    sessionId,
    session: {
      deriveMessages: () => messages,
    },
    ctx: {
      on(event, listener) {
        const set = listeners.get(event) ?? new Set()
        set.add(listener)
        listeners.set(event, set)
        return () => { set.delete(listener) }
      },
    },
    emit(event) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
    emitTurnEnd(reason) {
      for (const listener of [...(listeners.get('session/event') ?? [])]) {
        listener({ id: sessionId }, { type: 'turn/end', data: { turn: 1, reason } })
      }
    },
    setRunning(running) {
      agent.status = running ? 'running' : 'idle'
      agent.emit('agent/status')
    },
    reply(text) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text }] })
    },
    dispose() {
      agent.emit('agent/disposed')
    },
  }
  return agent
}

function queuedMessage(requestId: string): unknown {
  return { source: { kind: 'user', rpcId: requestId } }
}

/**
 * Record the way `code_agent` does: the prompt was just accepted, so the
 * session is either running or still holds the request in its inbox.
 */
function recordQueued(
  registry: ReturnType<typeof createCodeAgentRegistry>,
  agent: FakeAgent,
  requestId = 'code-agent-req-1',
  overrides: Partial<Parameters<ReturnType<typeof createCodeAgentRegistry>['record']>[0]> = {},
): void {
  agent.inbox.nextTurn = [queuedMessage(requestId)]
  registry.record({
    ...recordOptions({ requestId: requestId as never, ...overrides }),
    agent: agent as never,
  })
}

function recordOptions(overrides: Partial<Parameters<ReturnType<typeof createCodeAgentRegistry>['record']>[0]> = {}) {
  return {
    sessionId: 'session-agent-1' as SessionId,
    callerId: 'session-caller-1' as SessionId,
    task: '调研压缩机故障',
    cwd: '/tmp/dsh_orb/task',
    requestId: 'code-agent-req-1' as never,
    ...overrides,
  }
}

describe('registry provider plugin', () => {
  it('provides the shared registry under the service name', () => {
    const provided = new Map<string, unknown>()
    const ctx = { provide: (key: string, value: unknown) => { provided.set(key, value) } } as never as Context
    apply(ctx)
    expect(provided.get(CODE_AGENT_REGISTRY)).toBe(sharedCodeAgentRegistry())
  })
})

describe('code agent bookmark registry', () => {
  const AGENT = 'session-agent-1' as SessionId

  it('records a delegation as running and reports its fields', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    recordQueued(registry, agent)
    expect(registry.list()).toHaveLength(1)
    const [bookmark] = registry.list()
    expect(bookmark?.state).toBe('running')
    expect(bookmark?.task).toBe('调研压缩机故障')
    expect(bookmark?.cwd).toBe('/tmp/dsh_orb/task')
    expect(bookmark?.callerId).toBe('session-caller-1')
    expect(bookmark?.endedAt).toBeUndefined()
    expect(bookmark?.outcome).toBeUndefined()
  })

  it('keeps a queued stretch running while the inbox still holds its prompt', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    recordQueued(registry, agent)
    agent.setRunning(false)
    expect(registry.list()[0]?.state).toBe('running')
  })

  it('marks a stretch completed with its outcome once the session is idle', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('报告已写入 /tmp/report.md')
    recordQueued(registry, agent)
    agent.setRunning(true)
    agent.inbox.nextTurn = []
    agent.setRunning(false)
    const [bookmark] = registry.list()
    expect(bookmark?.state).toBe('completed')
    expect(typeof bookmark?.endedAt).toBe('number')
    expect(bookmark?.outcome).toBe('报告已写入 /tmp/report.md')
  })

  it('marks a stretch stopped on code_agent_stop and stays stopped across events', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    recordQueued(registry, agent)
    agent.setRunning(true)
    registry.markStopped(AGENT)
    agent.setRunning(false)
    expect(registry.list()[0]?.state).toBe('stopped')
    expect(registry.list()[0]?.endedAt).toBeDefined()
  })

  it('marks a stretch stopped when its watch aborts', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    const watch = new AbortController()
    recordQueued(registry, agent, 'code-agent-req-1', { watch })
    watch.abort()
    expect(registry.list()[0]?.state).toBe('stopped')
  })

  it('aborts the previous watch when the same session is recorded again', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    const first = new AbortController()
    const second = new AbortController()
    recordQueued(registry, agent, 'code-agent-req-1', { watch: first })
    recordQueued(registry, agent, 'code-agent-req-2', { watch: second })
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  it('keeps a watch that the replacement record itself carries', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    const shared = new AbortController()
    recordQueued(registry, agent, 'code-agent-req-1', { watch: shared })
    recordQueued(registry, agent, 'code-agent-req-2', { watch: shared })
    expect(shared.signal.aborted).toBe(false)
  })

  it('marks a disposed background session completed', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('done earlier')
    recordQueued(registry, agent)
    agent.dispose()
    const [bookmark] = registry.list()
    expect(bookmark?.state).toBe('completed')
    expect(bookmark?.outcome).toBe('done earlier')
  })

  it('refreshes task, start time, and state when the same session is continued', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('first outcome')
    recordQueued(registry, agent)
    agent.setRunning(true)
    agent.inbox.nextTurn = []
    agent.setRunning(false)
    expect(registry.list()[0]?.state).toBe('completed')

    // A queued stretch must not read as finished just because the previous
    // one went idle: the new prompt parks in the inbox before the stretch starts.
    agent.inbox.nextTurn = [queuedMessage('code-agent-req-2')]
    registry.record({
      ...recordOptions({
        task: '把报告字体改成绿色',
        requestId: 'code-agent-req-2' as never,
      }),
      agent: agent as never,
    })
    expect(registry.list()[0]?.state).toBe('running')
    const [bookmark] = registry.list()
    expect(bookmark?.state).toBe('running')
    expect(bookmark?.task).toBe('把报告字体改成绿色')
    expect(bookmark?.outcome).toBeUndefined()
    expect(bookmark?.endedAt).toBeUndefined()
  })

  it('drops every bookmark of a disposed caller', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    recordQueued(registry, agent)
    recordQueued(registry, agent, 'code-agent-req-2', { sessionId: 'session-agent-2' as SessionId })
    registry.record({
      ...recordOptions({ sessionId: 'session-agent-3' as SessionId, callerId: 'session-caller-2' as SessionId }),
    })
    registry.dropCaller('session-caller-1' as SessionId)
    const remaining = registry.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.sessionId).toBe('session-agent-3')
  })

  it('caps long outcomes with an ellipsis', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('x'.repeat(500))
    recordQueued(registry, agent)
    agent.setRunning(true)
    agent.inbox.nextTurn = []
    agent.setRunning(false)
    const outcome = registry.list()[0]?.outcome ?? ''
    expect(outcome.length).toBeLessThanOrEqual(200)
    expect(outcome.endsWith('…')).toBe(true)
  })

  it('marks a user-stopped stretch as stopped rather than completed', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('写到一半的输出')
    recordQueued(registry, agent)
    agent.setRunning(true)
    agent.inbox.nextTurn = []
    agent.emitTurnEnd({ kind: 'aborted', reason: { kind: 'user' } })
    agent.setRunning(false)
    const [bookmark] = registry.list()
    expect(bookmark?.state).toBe('stopped')
    expect(typeof bookmark?.endedAt).toBe('number')
  })

  it('keeps a normally finished stretch completed after a non-user abort reason', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    agent.reply('写到一半的输出')
    recordQueued(registry, agent)
    agent.setRunning(true)
    agent.inbox.nextTurn = []
    agent.emitTurnEnd({ kind: 'aborted', reason: { kind: 'legacy' } })
    agent.setRunning(false)
    expect(registry.list()[0]?.state).toBe('completed')
  })

  it('completes without an outcome when the messages cannot be derived', () => {
    const registry = createCodeAgentRegistry()
    const agent = fakeAgent(AGENT)
    recordQueued(registry, agent)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      agent.session.deriveMessages = () => { throw new Error('snapshot failed') }
      agent.setRunning(true)
      agent.inbox.nextTurn = []
      agent.setRunning(false)
      expect(registry.list()[0]?.state).toBe('completed')
      expect(registry.list()[0]?.outcome).toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
