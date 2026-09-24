/** macOS Screen Recording and Accessibility TCC status for Computer Use. */

/** One macOS privacy right Computer Use needs before capture or HID. */
export type TccRight = 'screen' | 'accessibility'

/** Whether that right is off, on for this process, or on in Settings but this process still cannot use it. */
export type TccRightState = 'missing' | 'granted' | 'needsRelaunch'

/** Snapshot the overlay gate and Settings page render. */
export interface TccStatus {
  /** False on Windows/Linux: the overlay gate stays hidden. */
  readonly applicable: boolean
  /** `app.name`: DeepSeek Orb when packaged, Electron in source launch. */
  readonly appName: string
  readonly screen: TccRightState
  readonly accessibility: TccRightState
}

/** System Settings deep links for the two Computer Use TCC panes. */
export const TCC_SETTINGS_URL = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
} as const

/**
 * Host callbacks the controller needs. Tests inject these; production uses Electron.
 */
export interface TccHost {
  readonly platform: NodeJS.Platform
  /** Current process display name for System Settings copy. */
  appName(): string
  /** Screen Recording TCC for this process. */
  screenGranted(): boolean
  /** Accessibility TCC for this process. */
  accessibilityGranted(): boolean
  /**
   * Open one System Settings pane.
   * @param url - a `TCC_SETTINGS_URL` value.
   */
  openExternal(url: string): Promise<unknown>
}

/**
 * Whether Computer Use may capture and post HID.
 * @param status - latest snapshot.
 * @returns true when TCC does not apply, or both rights are granted to this process.
 */
export function tccReady(status: TccStatus): boolean {
  return !status.applicable || (status.screen === 'granted' && status.accessibility === 'granted')
}

/**
 * Narrow an IPC argument to a known TCC right.
 * @param value - renderer payload.
 * @returns whether `value` is `screen` or `accessibility`.
 */
export function isTccRight(value: unknown): value is TccRight {
  return value === 'screen' || value === 'accessibility'
}

function rightState(granted: boolean, opened: boolean): TccRightState {
  if (granted) return 'granted'
  return opened ? 'needsRelaunch' : 'missing'
}

/**
 * Reads TCC, records which Settings panes the user opened, and opens those URLs.
 * Opening a pane that is still off becomes `needsRelaunch` after the next read.
 */
export class TccController {
  private readonly opened = new Set<TccRight>()

  /**
   * @param host - platform, `app.name`, and the two TCC probes.
   */
  constructor(private readonly host: TccHost) {}

  /**
   * Current Screen Recording and Accessibility snapshot.
   * @returns inapplicable/granted on non-Darwin; Darwin uses the host probes.
   */
  status(): TccStatus {
    const appName = this.host.appName()
    if (this.host.platform !== 'darwin') {
      return { applicable: false, appName, screen: 'granted', accessibility: 'granted' }
    }
    return {
      applicable: true,
      appName,
      screen: rightState(this.host.screenGranted(), this.opened.has('screen')),
      accessibility: rightState(this.host.accessibilityGranted(), this.opened.has('accessibility')),
    }
  }

  /**
   * Mark that pane as visited and open System Settings to it.
   * @param right - Screen Recording or Accessibility.
   */
  async open(right: TccRight): Promise<void> {
    this.opened.add(right)
    await this.host.openExternal(TCC_SETTINGS_URL[right])
  }
}
