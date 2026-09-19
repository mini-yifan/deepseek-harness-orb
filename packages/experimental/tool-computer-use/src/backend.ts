/**
 * Desktop capture and input used by Computer Use tools.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/backend
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createMacosDesktopBackend } from './macos.ts'
import { createUnsupportedDesktopBackend } from './unsupported.ts'

/** One observation surface: the overlay-skipped frontmost app's on-screen window union. */
export interface ScreenInfo {
  /** Zero-based index in the backend's current surface list. Always `0` in this cut. */
  readonly index: number
  /**
   * Logical global rectangle used for 0–1000 mapping.
   * Union of the owner window and every same-screen family window included in the shot.
   */
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  /** Backing-store scale of the `NSScreen` that contains the window (`1` on non-retina). */
  readonly scale: number
  /** CGWindowID of the owner window. Omit on fake/unsupported backends. */
  readonly windowId?: number
  /**
   * Extra family or layer-101 CGWindowIDs included in {@link bounds}.
   * Capture is always a screen rectangle of {@link bounds}.
   */
  readonly transientWindowIds?: readonly number[]
}

/** Encoded raster returned by one window capture. */
export interface CapturedScreen {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
}

/**
 * OS metadata attached once per observation, after skipping overlay window ids.
 * `windowTitle` is present when the remaining window has a nonempty title.
 * `finderFolder` is present only when the remaining frontmost app is Finder.
 * `focusNote` is present only when no remaining window has an owner name.
 */
export interface DesktopForeground {
  readonly appName: string
  readonly windowTitle?: string
  readonly finderFolder?: string
  readonly focusNote?: string
}

/** Activate a running app or launch it by display name or bundle id. */
export interface OpenAppInput {
  /** Localized display name or bundle identifier. */
  readonly name: string
}

/** Outcome of {@link DesktopBackend.openApp}. */
export interface OpenAppResult {
  /** `activated` when a running process was brought forward; `launched` when the app was started. */
  readonly kind: 'activated' | 'launched'
  /** Display name or requested identifier used for the action. */
  readonly name: string
}

/** Model-facing copy when inspect finds no remaining window after overlay skip. */
export const FOCUS_NOTE =
  'Keyboard focus is not on an operable app. Click the target window first if the next step needs focus.'

/** Observation payload for {@link FOCUS_NOTE}. */
export const FOCUS_FALLBACK_FOREGROUND: DesktopForeground = {
  appName: 'none',
  focusNote: FOCUS_NOTE,
}

/** Mouse button accepted by `click`. */
export type ClickButton = 'left' | 'right'

/** Pointer click on one screen. */
export interface ClickInput {
  readonly screen: ScreenInfo
  readonly position: readonly [number, number]
  readonly button: ClickButton
  readonly count: 1 | 2
  /** Modifier tokens held only for this click. Omit for a plain click. */
  readonly modifiers?: readonly string[]
}

/** Focus click plus keyboard typing. */
export interface TypeInput {
  readonly screen: ScreenInfo
  readonly position: readonly [number, number]
  readonly text: string
  readonly replace: boolean
  readonly submit: boolean
}

/** Wheel scroll at a point. */
export interface ScrollInput {
  readonly screen: ScreenInfo
  readonly position: readonly [number, number]
  readonly direction: 'up' | 'down'
  readonly scrollLevel: number
}

/** Posted key combination. */
export interface HotkeyInput {
  readonly keys: readonly string[]
}

/** Left-button press-and-hold on one screen. */
export interface LongPressInput {
  readonly screen: ScreenInfo
  readonly position: readonly [number, number]
  readonly durationSeconds: number
}

/** Pointer drag between two 0–1000 positions, possibly on different screens. */
export interface DragInput {
  readonly startScreen: ScreenInfo
  readonly startPosition: readonly [number, number]
  readonly endScreen: ScreenInfo
  readonly endPosition: readonly [number, number]
}

/** Open the default browser, or a validated http(s) URL in it. */
export interface OpenInBrowserInput {
  /** Normalized http(s) URL. Omit to launch the default browser with no page. */
  readonly url?: string
}

/** Open a resolved file or folder with Finder / the default app. */
export interface OpenInFinderInput {
  /** Absolute POSIX path after expand and realpath. */
  readonly path: string
  /** When true and `path` is a file, reveal it in Finder instead of opening it. */
  readonly revealOnly: boolean
}

/** Copy an already-written image file onto the system pasteboard. */
export interface CopyImageToClipboardInput {
  /** Absolute path of the PNG/JPEG/GIF/WebP file to place on the pasteboard. */
  readonly path: string
  /** Encoded type of the file at `path`. */
  readonly mediaType: ImageMediaType
}

/**
 * Capture plus HID input for one desktop. Production macOS implements this;
 * tests inject a fake; other platforms throw from each method.
 */
export interface DesktopBackend {
  /**
   * List the current observation surface (0 or 1 frontmost app after overlay skip;
   * bounds are that app's on-screen window union).
   * @param signal - cooperative cancellation.
   * @returns screens in backend index order; empty when no operable window remains.
   */
  listScreens(signal?: AbortSignal): Promise<readonly ScreenInfo[]>
  /**
   * Capture the observation rectangle as a display crop.
   * @param screen - surface selected from {@link listScreens}.
   * @param signal - cooperative cancellation.
   * @returns encoded image bytes and media type.
   */
  capture(screen: ScreenInfo, signal?: AbortSignal): Promise<CapturedScreen>
  /**
   * Report the frontmost app after skipping overlay CGWindowIDs, plus Finder's
   * folder when that app is Finder. Query failures return {@link FOCUS_FALLBACK_FOREGROUND}.
   * @param signal - cooperative cancellation.
   * @returns structured foreground metadata for the observation envelope.
   */
  inspectForeground(signal?: AbortSignal): Promise<DesktopForeground>
  /**
   * List localized names of running regular (Dock-visible) applications.
   * @param signal - cooperative cancellation.
   * @returns unique display names in the order the workspace reports them.
   */
  listApps(signal?: AbortSignal): Promise<readonly string[]>
  /**
   * Activate a running app or launch it by display name or bundle id.
   * @param input - name or bundle identifier.
   * @param signal - cooperative cancellation.
   * @returns whether the app was activated or launched.
   */
  openApp(input: OpenAppInput, signal?: AbortSignal): Promise<OpenAppResult>
  /**
   * Click at a 0–1000 position on `input.screen`.
   * @param input - screen, position, button, click count, and optional modifiers held only for this click.
   * @param signal - cooperative cancellation.
   */
  click(input: ClickInput, signal?: AbortSignal): Promise<void>
  /**
   * Click to focus, optionally select-all, type `text`, and optionally press Enter.
   * @param input - screen, position, text, and modifiers.
   * @param signal - cooperative cancellation.
   */
  typeText(input: TypeInput, signal?: AbortSignal): Promise<void>
  /**
   * Scroll at a 0–1000 position on `input.screen`.
   * @param input - screen, position, direction, and level.
   * @param signal - cooperative cancellation.
   */
  scroll(input: ScrollInput, signal?: AbortSignal): Promise<void>
  /**
   * Post a key combination. Callers must already reject screenshot chords.
   * @param input - key tokens.
   * @param signal - cooperative cancellation.
   */
  hotkey(input: HotkeyInput, signal?: AbortSignal): Promise<void>
  /**
   * Press and hold the left button at a 0–1000 position on `input.screen`.
   * @param input - screen, position, and hold duration in seconds.
   * @param signal - cooperative cancellation.
   */
  longPress(input: LongPressInput, signal?: AbortSignal): Promise<void>
  /**
   * Drag from `startPosition` to `endPosition`, mapping each through its screen.
   * @param input - start and end screens and 0–1000 positions.
   * @param signal - cooperative cancellation.
   */
  drag(input: DragInput, signal?: AbortSignal): Promise<void>
  /**
   * Launch the default browser, or open `input.url` in it.
   * @param input - optional normalized http(s) URL.
   * @param signal - cooperative cancellation.
   */
  openInBrowser(input: OpenInBrowserInput, signal?: AbortSignal): Promise<void>
  /**
   * Open a folder in Finder, open a file with its default app, or reveal a file.
   * @param input - resolved path and reveal flag.
   * @param signal - cooperative cancellation.
   */
  openInFinder(input: OpenInFinderInput, signal?: AbortSignal): Promise<void>
  /**
   * Replace the system pasteboard with the image at `input.path`.
   * Does not restore the previous clipboard.
   * @param input - written screenshot path and media type.
   * @param signal - cooperative cancellation.
   */
  copyImageToClipboard(input: CopyImageToClipboardInput, signal?: AbortSignal): Promise<void>
  /**
   * Hold overlay HID click-through for one GUI action plus its post-action screenshot.
   * Platform and fake backends run `run` immediately; Desktop `wrapDesktopBackend` uses `withInput`.
   * @param run - HID plus recapture.
   * @param signal - cooperative cancellation for the overlay cloak handshake.
   * @returns the value `run` resolves to.
   */
  withGuiTurn<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

/**
 * Construct the backend for a host platform.
 * @param platform - Node `process.platform` value; tests pass an explicit id.
 * @returns macOS capture/input on Darwin, otherwise a backend whose methods throw.
 */
export function createPlatformBackend(platform: NodeJS.Platform = process.platform): DesktopBackend {
  return platform === 'darwin' ? createMacosDesktopBackend() : createUnsupportedDesktopBackend()
}
