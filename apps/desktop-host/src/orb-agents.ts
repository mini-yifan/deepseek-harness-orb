/**
 * Desktop Host bookmark publisher: derive items from the `codeAgentRegistry`
 * service and push them to the Electron shell for the floating ball's agent
 * strip. Read state lives here; the shell only renders what it is told.
 * @module @deepseek-ai/dsh-desktop-host/orb-agents
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'

/** Poll interval for registry changes and elapsed-time ticks. */
export const ORB_AGENTS_POLL_MS = 1_000

/** One bookmark as the shell renders it. */
export interface OrbAgentItem {
  readonly sessionId: string
  readonly task: string
  readonly cwd: string
  readonly state: 'running' | 'completed' | 'stopped'
  readonly startedAt: number
  readonly endedAt?: number
  readonly outcome?: string
  readonly unread: boolean
}

/** Registry record fields this publisher reads. */
export interface OrbAgentBookmark {
  readonly sessionId: string
  readonly task: string
  readonly cwd: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly state: 'running' | 'completed' | 'stopped'
  readonly outcome?: string
}

/** Bookmark surface the registry exposes to this module. */
export interface OrbAgentBookmarkSource {
  list(): readonly OrbAgentBookmark[]
}

/** Cordis service name the Computer Use registry row provides. */
export const CODE_AGENT_REGISTRY_SERVICE = 'codeAgentRegistry'

/** Finished bookmarks the shell has opened; kept for the life of the process. */
const readBookmarks = new Set<string>()

/**
 * Mark one finished bookmark read so the next push drops it.
 * @param sessionId - background Code session the user opened.
 */
export function markOrbAgentRead(sessionId: string): void {
  readBookmarks.add(sessionId)
}

/**
 * Derive the strip payload from registry records.
 * Running bookmarks come first, oldest first; finished ones follow, newest first,
 * and a finished bookmark the user already opened is dropped.
 * @param bookmarks - registry list output.
 * @returns items ready for the shell.
 */
export function deriveOrbAgentItems(bookmarks: readonly OrbAgentBookmark[]): OrbAgentItem[] {
  const running = bookmarks
    .filter(bookmark => bookmark.state === 'running')
    .sort((left, right) => left.startedAt - right.startedAt)
  const finished = bookmarks
    .filter(bookmark => bookmark.state !== 'running')
    .sort((left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt))
  const items: OrbAgentItem[] = []
  for (const bookmark of [...running, ...finished]) {
    const sessionId = bookmark.sessionId
    if (bookmark.state !== 'running' && readBookmarks.has(sessionId)) continue
    items.push({
      sessionId,
      task: bookmark.task,
      cwd: bookmark.cwd,
      state: bookmark.state,
      startedAt: bookmark.startedAt,
      unread: bookmark.state !== 'running',
      ...(bookmark.endedAt === undefined ? {} : { endedAt: bookmark.endedAt }),
      ...(bookmark.outcome === undefined ? {} : { outcome: bookmark.outcome }),
    })
  }
  return items
}

/**
 * Start pushing bookmark items to the shell. Pushes only when the payload
 * changes, so the 1s poll costs nothing while the strip is stable.
 * @param ctx - Host context; the registry row is expected to be mounted.
 * @param send - process IPC sender to the Electron shell.
 */
export function installOrbAgentPublisher(ctx: Context, send: (message: object) => Promise<void>): void {
  let lastPayload = '[]'
  const publish = (): void => {
    const registry = ctx.get(CODE_AGENT_REGISTRY_SERVICE) as OrbAgentBookmarkSource | undefined
    if (registry === undefined) return
    const items = deriveOrbAgentItems(registry.list())
    const payload = JSON.stringify(items)
    if (payload === lastPayload) return
    lastPayload = payload
    void send({ type: 'orb-agents', items })
  }
  ctx.effect(() => {
    let stopped = false
    void (async () => {
      while (!stopped) {
        try {
          publish()
        } catch (error) {
          // A broken registry read must not stop the poll; the next pass retries.
          console.error(`dsh desktop: orb agent poll failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        await sleep(ORB_AGENTS_POLL_MS)
      }
    })()
    return () => {
      stopped = true
    }
  }, 'desktop-orb-agents: poll')
}
