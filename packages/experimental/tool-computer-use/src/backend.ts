/**
 * Desktop capture and input used by Computer Use tools.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/backend
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createMacosDesktopBackend } from './macos.ts'
import { createUnsupportedDesktopBackend } from './unsupported.ts'

/** One display's logical bounds and backing scale. */
export interface ScreenInfo {
  /** Zero-based index in the backend's current display list. */
  readonly index: number
  /** Logical global rectangle used for 0–1000 mapping and capture. */
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  /** Backing-store scale (`1` on a non-retina display). */
  readonly scale: number
}

/** Encoded raster returned by one display capture. */
export interface CapturedScreen {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
}

/**
 * OS metadata attached once per observation, after skipping overlay window ids.
 * `finderFolder` is present only when the remaining frontmost app is Finder.
 * `focusNote` is present only when no remaining window has an owner name.
 */
export interface DesktopForeground {
  readonly appName: string
  readonly finderFolder?: string
  readonly focusNote?: string
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

/**
 * Capture plus HID input for one desktop. Production macOS implements this;
 * tests inject a fake; other platforms throw from each method.
 */
export interface DesktopBackend {
  /**
   * List currently attached displays.
   * @param signal - cooperative cancellation.
   * @returns screens in backend index order.
   */
  listScreens(signal?: AbortSignal): Promise<readonly ScreenInfo[]>
  /**
   * Capture one display, including the cursor when the platform supports it.
   * @param screen - display selected from {@link listScreens}.
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
   * Click at a 0–1000 position on `input.screen`.
   * @param input - screen, position, button, and click count.
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
}

/**
 * Construct the backend for a host platform.
 * @param platform - Node `process.platform` value; tests pass an explicit id.
 * @returns macOS capture/input on Darwin, otherwise a backend whose methods throw.
 */
export function createPlatformBackend(platform: NodeJS.Platform = process.platform): DesktopBackend {
  return platform === 'darwin' ? createMacosDesktopBackend() : createUnsupportedDesktopBackend()
}
