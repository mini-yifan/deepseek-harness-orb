import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_APP_ORIGIN,
  OVERLAY_CLIENT_SURFACE,
  OVERLAY_INDEX_HREF,
  OVERLAY_SESSION_MESSAGE_TYPE,
  OVERLAY_SESSIONS_CURRENT_PERSIST,
  OVERLAY_SHELL_ORIGIN,
  OVERLAY_THEME_MESSAGE_TYPE,
  SESSIONS_CURRENT_PERSIST,
  overlayClientSurface,
  overlaySessionId,
  overlaySessionMessage,
  overlayThemeMessage,
  sessionsSelectionPersistName,
} from '../src/client/overlay-surface.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('overlay client surface', () => {
  it('reads surface=overlay from an explicit search string', () => {
    expect(overlayClientSurface('?surface=overlay')).toBe(true)
    expect(overlayClientSurface('surface=overlay')).toBe(true)
    expect(overlayClientSurface('?surface=app')).toBe(false)
    expect(overlayClientSurface('')).toBe(false)
    expect(sessionsSelectionPersistName('?surface=overlay')).toBe(OVERLAY_SESSIONS_CURRENT_PERSIST)
    expect(sessionsSelectionPersistName('')).toBe(SESSIONS_CURRENT_PERSIST)
    expect(OVERLAY_CLIENT_SURFACE).toBe('overlay')
    expect(OVERLAY_INDEX_HREF).toBe(`${OVERLAY_APP_ORIGIN}/index.html?surface=overlay`)
    expect(overlaySessionId('s1')).toBe('s1')
    expect(overlaySessionMessage({ type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 's1' }))
      .toEqual({ type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 's1' })
    expect(overlaySessionMessage({ type: OVERLAY_SESSION_MESSAGE_TYPE })).toBeUndefined()
    expect(overlaySessionMessage(null)).toBeUndefined()
    expect(overlayThemeMessage({ type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: 'dark' }))
      .toEqual({ type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: 'dark' })
    expect(overlayThemeMessage({ type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: 'light' }))
      .toEqual({ type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: 'light' })
    expect(overlayThemeMessage({ type: OVERLAY_THEME_MESSAGE_TYPE, colorScheme: 'system' })).toBeUndefined()
    expect(overlayThemeMessage({ type: OVERLAY_THEME_MESSAGE_TYPE })).toBeUndefined()
    expect(overlayThemeMessage(null)).toBeUndefined()
    expect(OVERLAY_SHELL_ORIGIN).toBe('dsh-app://shell')
  })

  it('reads location.search when search is omitted', () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    expect(overlayClientSurface()).toBe(true)
    expect(sessionsSelectionPersistName()).toBe(OVERLAY_SESSIONS_CURRENT_PERSIST)
  })

  it('treats a missing location as the main window', () => {
    vi.stubGlobal('location', undefined)
    expect(overlayClientSurface()).toBe(false)
    expect(sessionsSelectionPersistName()).toBe(SESSIONS_CURRENT_PERSIST)
  })
})
