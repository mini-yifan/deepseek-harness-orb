/**
 * In-memory desktop used by tests and keyless snapshots. Never drives a real GUI.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/fake
 */

import type {
  CapturedScreen,
  ClickInput,
  DesktopBackend,
  DesktopForeground,
  DragInput,
  HotkeyInput,
  LongPressInput,
  OpenInBrowserInput,
  OpenInFinderInput,
  ScreenInfo,
  ScrollInput,
  TypeInput,
} from './backend.ts'

/** 1×1 red PNG used as the fixture desktop image. */
export const FAKE_DESKTOP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

/** Recorded fake-desktop action for assertions. */
export type FakeDesktopAction =
  | { readonly type: 'click'; readonly input: ClickInput }
  | { readonly type: 'typeText'; readonly input: TypeInput }
  | { readonly type: 'scroll'; readonly input: ScrollInput }
  | { readonly type: 'hotkey'; readonly input: HotkeyInput }
  | { readonly type: 'longPress'; readonly input: LongPressInput }
  | { readonly type: 'drag'; readonly input: DragInput }
  | { readonly type: 'openInBrowser'; readonly input: OpenInBrowserInput }
  | { readonly type: 'openInFinder'; readonly input: OpenInFinderInput }

/** Fake backend that records HID calls and returns a fixture PNG. */
export interface FakeDesktopBackend extends DesktopBackend {
  /** Actions in call order. */
  readonly actions: readonly FakeDesktopAction[]
}

/** Options for {@link createFakeDesktopBackend}. */
export interface FakeDesktopOptions {
  /** Encoded PNG returned by every capture. Default: {@link FAKE_DESKTOP_PNG}. */
  readonly png?: Uint8Array
  /** Display list. Default: one 1000×800 logical screen. */
  readonly screens?: readonly ScreenInfo[]
  /** Foreground metadata. Default: Pages with no Finder folder. */
  readonly foreground?: DesktopForeground
}

const DEFAULT_SCREENS: readonly ScreenInfo[] = [
  { index: 0, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scale: 2 },
]

/**
 * Construct a fake desktop that records actions and returns a fixture PNG.
 * @param options - optional screens, PNG bytes, and foreground metadata.
 * @returns a test/snapshot backend.
 */
export function createFakeDesktopBackend(options: FakeDesktopOptions = {}): FakeDesktopBackend {
  const png = options.png ?? FAKE_DESKTOP_PNG
  const screens = options.screens ?? DEFAULT_SCREENS
  const foreground = options.foreground ?? { appName: 'Pages' }
  const actions: FakeDesktopAction[] = []
  const captured: CapturedScreen = { data: png, mediaType: 'image/png' }
  return {
    get actions() {
      return actions
    },
    listScreens: () => Promise.resolve(screens),
    capture: () => Promise.resolve(captured),
    inspectForeground: () => Promise.resolve(foreground),
    click: (input) => {
      actions.push({ type: 'click', input })
      return Promise.resolve()
    },
    typeText: (input) => {
      actions.push({ type: 'typeText', input })
      return Promise.resolve()
    },
    scroll: (input) => {
      actions.push({ type: 'scroll', input })
      return Promise.resolve()
    },
    hotkey: (input) => {
      actions.push({ type: 'hotkey', input })
      return Promise.resolve()
    },
    longPress: (input) => {
      actions.push({ type: 'longPress', input })
      return Promise.resolve()
    },
    drag: (input) => {
      actions.push({ type: 'drag', input })
      return Promise.resolve()
    },
    openInBrowser: (input) => {
      actions.push({ type: 'openInBrowser', input })
      return Promise.resolve()
    },
    openInFinder: (input) => {
      actions.push({ type: 'openInFinder', input })
      return Promise.resolve()
    },
  }
}
