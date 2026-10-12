/**
 * Bookmark registry for `code_agent` background sessions.
 * Lifetime is the host process: a consumer shows what this process knows, nothing older.
 * The registry is a module singleton (not only a Cordis service) so the preset-internal
 * `code_agent` tool and any top-level consumer observe the same records; {@link apply}
 * publishes it as the `codeAgentRegistry` service for consumers that live in another
 * realm and cannot import this module.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/code-agent-registry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { holdsPrompt, isUserCancellation, lastAssistantText } from './code-agent-completion.ts'

/** Cordis service name the Desktop Host reads bookmarks from. */
export const CODE_AGENT_REGISTRY = 'codeAgentRegistry'

/** Cordis plugin name for the top-level provider row in the Computer Use patch. */
export const name = 'computer-use-code-agent-registry'

/** A finished stretch either delivered its outcome or was cancelled. */
export type CodeAgentBookmarkState = 'running' | 'completed' | 'stopped'

/** One background Code session as a bookmark strip shows it. */
export interface CodeAgentBookmark {
  readonly sessionId: SessionId
  readonly callerId: SessionId
  readonly task: string
  readonly cwd: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly state: CodeAgentBookmarkState
  readonly outcome?: string
}

/** Cap on the outcome summary one bookmark carries; the full text lives in the session. */
export const BOOKMARK_OUTCOME_MAX_CHARS = 200

interface BookmarkRecord {
  readonly sessionId: SessionId
  readonly callerId: SessionId
  readonly task: string
  readonly cwd: string
  readonly requestId: SessionRequestId
  watch: AbortController | undefined
  agent: Agent | undefined
  startedAt: number
  endedAt: number | undefined
  state: CodeAgentBookmarkState
  outcome: string | undefined
  /** Set while the newest observed `turn/end` for this session is a user cancellation. */
  userStopped: boolean
  detach: (() => void) | undefined
}

/** Everything a consumer reads bookmarks with. */
export interface CodeAgentBookmarkRegistry {
  /**
   * Track one accepted `code_agent` prompt.
   * @param entry - accepted prompt, its caller, and the live agents when available.
   */
  record(entry: {
    readonly sessionId: SessionId
    readonly callerId: SessionId
    readonly task: string
    readonly cwd: string
    readonly requestId: SessionRequestId
    readonly watch?: AbortController
    readonly agent?: Agent
  }): void
  /**
   * Drop every bookmark recorded by one caller; used when that caller's context is disposed.
   * @param callerId - Computer Use session that recorded the bookmarks.
   */
  dropCaller(callerId: SessionId): void
  /**
   * Mark one session's bookmark stopped, after `code_agent_stop` aborted its watches.
   * @param sessionId - background Code session.
   */
  markStopped(sessionId: SessionId): void
  /**
   * Current bookmarks, re-deriving each record's state before returning it.
   * @returns one entry per tracked session, in record order.
   */
  list(): readonly CodeAgentBookmark[]
}

/**
 * One registry per host process. `code_agent`'s apply may run again (plugin
 * re-apply, tests); every caller records into the same instance so a consumer
 * always reads the live set.
 * @returns the process-wide registry.
 */
export function sharedCodeAgentRegistry(): CodeAgentBookmarkRegistry {
  shared ??= createCodeAgentRegistry()
  return shared
}

let shared: CodeAgentBookmarkRegistry | undefined

/**
 * Publish the process-wide registry as the `codeAgentRegistry` service.
 * The provider row is inserted at the top level of the Computer Use patch
 * (never inside the preset) so a top-level consumer can read it across the
 * preset boundary.
 * @param ctx - provider row context.
 */
export function apply(ctx: Context): void {
  ctx.provide(CODE_AGENT_REGISTRY, sharedCodeAgentRegistry())
}

/**
 * Construct one independent registry; tests use this to isolate state.
 * @returns an empty registry.
 */
export function createCodeAgentRegistry(): CodeAgentBookmarkRegistry {
  const records = new Map<SessionId, BookmarkRecord>()
  return {
    record(entry) {
      const previous = records.get(entry.sessionId)
      if (previous !== undefined) {
        detachRecord(previous)
        // This record replaces the previous stretch's bookmark; a watch left running could
        // only fire a notice for a stretch nobody tracks any more.
        if (previous.watch !== undefined && previous.watch !== entry.watch) previous.watch.abort()
      }
      const record: BookmarkRecord = {
        sessionId: entry.sessionId,
        callerId: entry.callerId,
        task: entry.task,
        cwd: entry.cwd,
        requestId: entry.requestId,
        watch: entry.watch,
        agent: entry.agent,
        startedAt: Date.now(),
        endedAt: undefined,
        state: 'running',
        outcome: undefined,
        userStopped: false,
        detach: undefined,
      }
      records.set(entry.sessionId, record)
      subscribe(record)
      // The stretch may have started (or even finished) between the accepted
      // prompt and this record; one immediate pass avoids a missed transition.
      evaluate(record)
    },
    dropCaller(callerId) {
      for (const [sessionId, record] of records) {
        if (record.callerId !== callerId) continue
        detachRecord(record)
        records.delete(sessionId)
      }
    },
    markStopped(sessionId) {
      const record = records.get(sessionId)
      if (record !== undefined) stopRecord(record)
    },
    list() {
      const items: CodeAgentBookmark[] = []
      for (const record of records.values()) {
        // Re-derive on every read so a missed event heals at the next poll.
        evaluate(record)
        items.push({
          sessionId: record.sessionId,
          callerId: record.callerId,
          task: record.task,
          cwd: record.cwd,
          startedAt: record.startedAt,
          state: record.state,
          ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
          ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
        })
      }
      return items
    },
  }
}

/** Fold one live status into the record's state. Queued prompts are still running. */
function evaluate(record: BookmarkRecord): void {
  try {
    evaluateRecord(record)
  } catch (error) {
    // A session whose messages cannot be derived must not throw into the agent's event
    // dispatch — other listeners share it — so the bookmark keeps what it had. The log
    // keeps the failure visible instead of leaving only the "running" state behind.
    console.error(
      `computer-use: bookmark ${record.sessionId} could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function evaluateRecord(record: BookmarkRecord): void {
  if (record.state === 'stopped') return
  if (record.watch?.signal.aborted === true) {
    stopRecord(record)
    return
  }
  const agent = record.agent
  if (agent === undefined) return
  if (agent.status === 'running') {
    record.state = 'running'
    return
  }
  if (holdsPrompt(agent, record.requestId)) return
  completeRecord(record, agent)
}

function stopRecord(record: BookmarkRecord): void {
  record.state = 'stopped'
  record.endedAt ??= Date.now()
  detachRecord(record)
}

function completeRecord(record: BookmarkRecord, agent: Agent): void {
  if (record.userStopped) {
    // The user stopped this stretch from the main window: same surface as code_agent_stop,
    // and the caller's notice says not to relaunch.
    stopRecord(record)
    return
  }
  record.state = 'completed'
  record.endedAt ??= Date.now()
  record.outcome = capOutcome(lastAssistantText(agent))
  detachRecord(record)
}

function detachRecord(record: BookmarkRecord): void {
  record.detach?.()
  record.detach = undefined
}

function subscribe(record: BookmarkRecord): void {
  detachRecord(record)
  const agent = record.agent
  if (agent === undefined) return
  const disposers: (() => void)[] = []
  try {
    const off = agent.ctx.on('agent/status', () => { evaluate(record) })
    if (typeof off === 'function') disposers.push(off)
  } catch {
    // Test fakes may not carry the status event.
  }
  try {
    const off = agent.ctx.on('session/event', (session, event) => {
      if (session.id !== record.sessionId) return
      if (event.type !== 'turn/end') return
      record.userStopped = isUserCancellation(event.data.reason)
      evaluate(record)
    })
    if (typeof off === 'function') disposers.push(off)
  } catch {
    // Test fakes may not carry session events.
  }
  try {
    const off = agent.ctx.on('agent/disposed', () => {
      if (record.state === 'stopped') return
      record.state = 'completed'
      record.endedAt ??= Date.now()
      try {
        record.outcome = capOutcome(lastAssistantText(agent))
      } catch {
        // A disposed agent may no longer expose its messages.
      }
      detachRecord(record)
    })
    if (typeof off === 'function') disposers.push(off)
  } catch {
    // Test fakes may not carry the disposal event.
  }
  record.detach = () => {
    for (const off of disposers.splice(0)) off()
  }
}

function capOutcome(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  return trimmed.length <= BOOKMARK_OUTCOME_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, BOOKMARK_OUTCOME_MAX_CHARS - 1)}…`
}
