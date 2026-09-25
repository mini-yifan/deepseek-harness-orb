/**
 * Experimental Computer Use plugin: exclusive GUI tools plus a first-turn screenshot.
 * Observation rides existing `user/message` and `tool/result` events; `screenshot` writes Desktop files and the clipboard.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use
 */

import type { Context } from '@deepseek-ai/cordis'
import { createPlatformBackend } from './backend.ts'
import type { OverlayExcludedRegionCapture } from './macos.ts'
import { Config, resolveComputerUseConfig } from './config.ts'
import { wrapDesktopBackend } from './overlay-guard.ts'
import { applyComputerUse, PLUGIN_NAME } from './plugin.ts'

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export { createPlatformBackend } from './backend.ts'
export type {
  CapturedScreen,
  ClickButton,
  ClickInput,
  CopyImageToClipboardInput,
  DesktopBackend,
  DesktopForeground,
  DragInput,
  HotkeyInput,
  LongPressInput,
  OpenAppInput,
  OpenAppResult,
  OpenInBrowserInput,
  OpenInFinderInput,
  ScreenInfo,
  ScrollInput,
  TypeInput,
} from './backend.ts'
export { FOCUS_FALLBACK_FOREGROUND, FOCUS_NOTE, UNFOCUSED_WINDOW_NOTE } from './backend.ts'
export { Config, resolveComputerUseConfig } from './config.ts'
export type { ResolvedComputerUseConfig } from './config.ts'
export { createFakeDesktopBackend, FAKE_DESKTOP_PNG } from './fake.ts'
export type { FakeDesktopAction, FakeDesktopBackend, FakeDesktopOptions } from './fake.ts'
export { applyComputerUse, PLUGIN_NAME, POLICY_SECTION_ORDER } from './plugin.ts'
export { POLICY } from './policy.ts'
export { wrapDesktopBackend } from './overlay-guard.ts'
export type { ComputerUseOverlayGuard } from './overlay-guard.ts'

/** Cordis plugin name. */
export const name = PLUGIN_NAME

/** Services required at apply time. Missing attachments keep the plugin pending. */
export const inject = ['tools', 'systemPrompt', 'attachments']

/**
 * Resolve the overlay cloak when a desktop method runs.
 * Desktop Host installs `computerUseOverlayGuard` after profile plugins apply, so a one-time read during `apply` stays empty.
 * @param ctx - plugin context that may later provide `computerUseOverlayGuard`.
 * @param inner - platform backend. Its overlay-exclude capture also reads the guard at call time.
 * @returns a backend that cloaks only while the guard service is present.
 */
function desktopBackend(ctx: Context, inner: ReturnType<typeof createPlatformBackend>): ReturnType<typeof createPlatformBackend> {
  const resolve = (): ReturnType<typeof createPlatformBackend> => {
    const guard = ctx.get('computerUseOverlayGuard')
    return guard === undefined ? inner : wrapDesktopBackend(inner, guard)
  }
  return {
    withGuiTurn: (run, signal) => resolve().withGuiTurn(run, signal),
    listScreens: signal => resolve().listScreens(signal),
    capture: (screen, signal) => resolve().capture(screen, signal),
    inspectForeground: signal => resolve().inspectForeground(signal),
    listApps: signal => resolve().listApps(signal),
    openApp: (input, signal) => resolve().openApp(input, signal),
    click: (input, signal) => resolve().click(input, signal),
    typeText: (input, signal) => resolve().typeText(input, signal),
    scroll: (input, signal) => resolve().scroll(input, signal),
    hotkey: (input, signal) => resolve().hotkey(input, signal),
    longPress: (input, signal) => resolve().longPress(input, signal),
    drag: (input, signal) => resolve().drag(input, signal),
    openInBrowser: (input, signal) => resolve().openInBrowser(input, signal),
    openInFinder: (input, signal) => resolve().openInFinder(input, signal),
    copyImageToClipboard: (input, signal) => resolve().copyImageToClipboard(input, signal),
  }
}

/**
 * Mount Computer Use with the host-platform backend.
 * When Desktop Host provides `computerUseOverlayGuard`, capture, inspect, listScreens, HID, and withGuiTurn run
 * inside overlay-guard intervals, `listScreens` waits for the observation-frame ribbon ack, and overlay-exclude
 * capture runs ScreenCaptureKit in the Electron process.
 * The guard is read on each desktop call, including when Host installs it after this plugin applies.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; omitted fields use schema defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const excludedRegionCapture: OverlayExcludedRegionCapture = (input) => {
    const capture = ctx.get('computerUseOverlayGuard')?.captureExcludedRegion
    if (capture === undefined) {
      return Promise.reject(new Error('dsh desktop: overlay-exclude capture is not attached'))
    }
    const { signal, ...region } = input
    return capture(region, signal)
  }
  const backend = createPlatformBackend(process.platform, excludedRegionCapture)
  applyComputerUse(ctx, desktopBackend(ctx, backend), resolveComputerUseConfig(config))
}
