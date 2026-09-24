/** Narrow Desktop app-document bridge duplicated from apps/desktop (this package cannot import that app). */

/** One provider/model route, with optional reasoning effort. */
export interface OrbAgentModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Current floating-ball preferences the Settings page reads. */
export interface OrbSettingsSnapshot {
  readonly supported: boolean
  readonly avatarUrl: string
  readonly overlay: OrbAgentModelSelection
  readonly background: OrbAgentModelSelection
  readonly selectionEnabled: boolean
  readonly millifractionEnabled: boolean
  readonly tcc: TccStatus
}

/** One macOS privacy right Computer Use needs before capture or HID. */
export type TccRight = 'screen' | 'accessibility'

/** Whether that right is off, on for this process, or on in Settings but this process still cannot use it. */
export type TccRightState = 'missing' | 'granted' | 'needsRelaunch'

/** Snapshot the overlay gate and Settings page render. */
export interface TccStatus {
  readonly applicable: boolean
  readonly appName: string
  readonly screen: TccRightState
  readonly accessibility: TccRightState
}

/** Result of confirming a millifraction-coordinates default change. */
export type OrbMillifractionWriteResult =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly snapshot: OrbSettingsSnapshot }

/** Why a custom ball image was not installed. */
export type OrbAvatarWriteError = 'cancelled' | 'too-large' | 'invalid-type'

/** Result of picking a custom ball image. */
export type OrbAvatarWriteResult =
  | { readonly ok: true; readonly snapshot: OrbSettingsSnapshot }
  | { readonly ok: false; readonly error: OrbAvatarWriteError }

/** Main-window `window.dshDesktop` face used by this Settings page. */
export interface DshDesktopAppApi {
  readonly protocolVersion: 1
  readonly orb: {
    supported(): Promise<boolean>
    snapshot(): Promise<OrbSettingsSnapshot>
    pickAvatar(): Promise<OrbAvatarWriteResult>
    restoreAvatar(): Promise<OrbSettingsSnapshot>
    setOverlayModel(selection: OrbAgentModelSelection): Promise<void>
    setBackgroundModel(selection: OrbAgentModelSelection): Promise<void>
    setSelectionEnabled(enabled: boolean): Promise<void>
    setMillifractionEnabled(enabled: boolean): Promise<OrbMillifractionWriteResult>
    openTcc(right: TccRight): Promise<OrbSettingsSnapshot>
  }
}

/**
 * Read the Desktop app-document bridge when this document is `dsh-app://app`.
 * @returns the typed API, or undefined in `dsh web` and on the startup page.
 */
export function readDesktopAppApi(): DshDesktopAppApi | undefined {
  const value = (globalThis as { dshDesktop?: unknown }).dshDesktop
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { protocolVersion?: unknown; orb?: unknown }
  if (record.protocolVersion !== 1 || typeof record.orb !== 'object' || record.orb === null) {
    return undefined
  }
  return value as DshDesktopAppApi
}
