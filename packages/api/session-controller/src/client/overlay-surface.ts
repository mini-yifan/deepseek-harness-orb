import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Query value that selects Compact Chat inside the Desktop overlay iframe. */
export const OVERLAY_CLIENT_SURFACE = 'overlay'

/** Main-window ClientSessions selection persist cell. */
export const SESSIONS_CURRENT_PERSIST = 'dsh.sessions.current'

/** Overlay iframe ClientSessions selection persist cell. Isolated from the main window. */
export const OVERLAY_SESSIONS_CURRENT_PERSIST = 'dsh.overlay.sessions.current'

/** postMessage type the shell posts into the overlay iframe with the orb Session id. */
export const OVERLAY_SESSION_MESSAGE_TYPE = 'dsh.overlay.session'

/** postMessage type the overlay iframe posts when it can accept a Session id. */
export const OVERLAY_READY_MESSAGE_TYPE = 'dsh.overlay.ready'

/** postMessage type the overlay iframe posts with the Host-resolved color scheme. */
export const OVERLAY_THEME_MESSAGE_TYPE = 'dsh.overlay.theme'

/** Origin of the packaged Web client, including the overlay iframe document. */
export const OVERLAY_APP_ORIGIN = 'dsh-app://app'

/** Origin of the floating-ball shell page. */
export const OVERLAY_SHELL_ORIGIN = 'dsh-app://shell'

/** Overlay Compact Chat document loaded inside the floating-ball transcript iframe. */
export const OVERLAY_INDEX_HREF = `${OVERLAY_APP_ORIGIN}/index.html?surface=${OVERLAY_CLIENT_SURFACE}`

/** One Session-id post from the floating-ball shell into the overlay iframe. */
export interface OverlaySessionMessage {
  type: typeof OVERLAY_SESSION_MESSAGE_TYPE
  sessionId: string
}

/** One Host-resolved color-scheme post from the overlay iframe into the floating-ball shell. */
export interface OverlayThemeMessage {
  type: typeof OVERLAY_THEME_MESSAGE_TYPE
  colorScheme: 'light' | 'dark'
}

/**
 * Brand a posted overlay Session id.
 * @param value - opaque Session id from the shell page.
 * @returns the same id as a SessionId.
 */
export function overlaySessionId(value: string): SessionId {
  return value as SessionId
}

/**
 * Read a shell Session-id post.
 * @param data - `MessageEvent.data` from the overlay iframe.
 * @returns the typed message when the type and sessionId are present.
 */
export function overlaySessionMessage(data: unknown): OverlaySessionMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as { type?: unknown; sessionId?: unknown }
  if (record.type !== OVERLAY_SESSION_MESSAGE_TYPE || typeof record.sessionId !== 'string') return undefined
  return { type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: record.sessionId }
}

/**
 * Read an overlay color-scheme post.
 * @param data - `MessageEvent.data` from the overlay iframe.
 * @returns the typed message when the type and colorScheme are present.
 */
export function overlayThemeMessage(data: unknown): OverlayThemeMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as { type?: unknown; colorScheme?: unknown }
  if (record.type !== OVERLAY_THEME_MESSAGE_TYPE) return undefined
  if (record.colorScheme !== 'light' && record.colorScheme !== 'dark') return undefined
  return { type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: record.colorScheme }
}

/**
 * Read whether this document is the overlay Compact Chat surface.
 * `location.search` is a document query boundary.
 * @param search - `location.search`; omitted uses the current document when one exists.
 * @returns true when the `surface` query equals {@link OVERLAY_CLIENT_SURFACE}.
 */
export function overlayClientSurface(search?: string): boolean {
  const raw = search ?? (typeof location === 'undefined' ? '' : location.search)
  const query = raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(query).get('surface') === OVERLAY_CLIENT_SURFACE
}

/**
 * Persist name for ClientSessions selection on this document.
 * @param search - `location.search`; omitted uses the current document when one exists.
 * @returns the overlay persist name on the overlay surface, otherwise the main-window name.
 */
export function sessionsSelectionPersistName(search?: string): string {
  return overlayClientSurface(search) ? OVERLAY_SESSIONS_CURRENT_PERSIST : SESSIONS_CURRENT_PERSIST
}
