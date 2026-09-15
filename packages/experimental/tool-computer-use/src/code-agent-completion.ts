/**
 * Park a plugin followup on the Computer Use caller until both the delegated
 * Code session and the caller are idle.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/code-agent-completion
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'

/** Plugin id recorded on the parked completion notice. */
export const COMPLETION_PLUGIN = 'tool-code-agent'

/** Model-facing body cap for one completion notice. */
export const COMPLETION_BODY_MAX_CHARS = 4000

const NO_ASSISTANT = 'The Code agent session ended without a final assistant message.'

/** Host agent registry methods the watch uses after `session.prompt` accepts. */
export interface CodeAgentLookup {
  get(id: SessionId): Agent | undefined
  withoutInitiator<T>(operation: () => T): T
}

/** One accepted `code_agent` prompt and the two live Agents that own its interval. */
export interface CodeAgentCompletionWatch {
  readonly caller: Agent
  readonly code: Agent
  readonly agents: CodeAgentLookup
  readonly task: string
  readonly sessionId: SessionId
  readonly requestId: SessionRequestId
}

/**
 * Start a caller-owned watch that delivers one plugin notice after the Code
 * session's next idle and the Computer Use caller is idle. Does not throw;
 * missing context or a disposed caller drops the notice.
 * @param watch - live caller, live Code agent, and the accepted prompt.
 */
export function watchCodeAgentCompletion(watch: CodeAgentCompletionWatch): void {
  const abort = new AbortController()
  try {
    watch.caller.ctx.effect(() => {
      return () => {
        abort.abort()
      }
    })
  } catch {
    // Computer Use agent context already disposed; no owner for the watch.
    return
  }
  try {
    watch.agents.withoutInitiator(() => {
      void runWatch(watch, abort.signal)
    })
  } catch {
    // Agent initiator scope is closing; a watch would outlive its owner.
    abort.abort()
  }
}

async function runWatch(watch: CodeAgentCompletionWatch, signal: AbortSignal): Promise<void> {
  try {
    if (await raceAbort(signal, waitUntilIntervalStarts(watch.code, watch.requestId, signal)) === 'aborted') {
      return
    }
    if (await raceAbort(signal, watch.code.whenIdle()) === 'aborted') return
    const outcome = lastAssistantText(watch.code) ?? NO_ASSISTANT
    if (await raceAbort(signal, watch.caller.whenIdle()) === 'aborted') return
    if (watch.agents.get(watch.caller.id) !== watch.caller) return
    watch.caller.followup(createUserMessage({
      content: [{ type: 'text', text: completionNoticeText(watch.sessionId, watch.task, outcome) }],
      source: {
        kind: 'plugin',
        plugin: COMPLETION_PLUGIN,
        form: 'notice',
        summary: boundContextSummary(`Code agent ${watch.sessionId} finished`),
      },
    }))
  } catch (error) {
    if (signal.aborted) return
    try {
      watch.caller.ctx.logger.warn(`code_agent: completion watch failed: ${String(error)}`)
    } catch {
      // Test fakes and disposed contexts may have no logger.
    }
  }
}

/**
 * The Code interval has started when the driver is running, or when the
 * accepted prompt is no longer queued (already claimed or already finished).
 */
function intervalHasStarted(code: Agent, requestId: SessionRequestId): boolean {
  return code.status === 'running' || !holdsPrompt(code, requestId)
}

function holdsPrompt(code: Agent, requestId: SessionRequestId): boolean {
  return messageHasRpc(code.inbox.nextTurn, requestId) || messageHasRpc(code.inbox.nextStep, requestId)
}

function messageHasRpc(messages: readonly UserMessage[], requestId: SessionRequestId): boolean {
  return messages.some(message => (
    message.source.kind === 'user'
    && 'rpcId' in message.source
    && message.source.rpcId === requestId
  ))
}

async function waitUntilIntervalStarts(
  code: Agent,
  requestId: SessionRequestId,
  signal: AbortSignal,
): Promise<void> {
  if (intervalHasStarted(code, requestId) || signal.aborted) return
  await new Promise<void>((resolve) => {
    let done = false
    let disposeStatus = (): void => {}
    let disposeDisposed = (): void => {}
    const finish = (): void => {
      if (done) return
      done = true
      disposeStatus()
      disposeDisposed()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    disposeStatus = code.ctx.on('agent/status', () => {
      if (intervalHasStarted(code, requestId)) finish()
    })
    disposeDisposed = code.ctx.on('agent/disposed', finish)
    signal.addEventListener('abort', finish, { once: true })
    if (intervalHasStarted(code, requestId) || signal.aborted) finish()
  })
}

async function raceAbort(signal: AbortSignal, work: Promise<void>): Promise<'aborted' | 'done'> {
  if (signal.aborted) return 'aborted'
  const abort = Promise.withResolvers<'aborted'>()
  const onAbort = (): void => {
    abort.resolve('aborted')
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([work.then(() => 'done' as const), abort.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function lastAssistantText(code: Agent): string | undefined {
  const messages = code.session.deriveMessages()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return undefined
}

function completionNoticeText(sessionId: SessionId, task: string, outcome: string): string {
  const body = `Background Code agent session ${sessionId} finished this task:\n${task}\n\n${outcome}`
  if (body.length <= COMPLETION_BODY_MAX_CHARS) return body
  return `${body.slice(0, COMPLETION_BODY_MAX_CHARS - 1)}…`
}
