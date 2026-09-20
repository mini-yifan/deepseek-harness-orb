/**
 * Experimental Computer Use plugin: exclusive GUI tools plus a first-turn screenshot.
 * Observation rides existing `user/message` and `tool/result` events; `screenshot` writes Desktop files and the clipboard.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use
 */

import type { Context } from '@deepseek-ai/cordis'
import { createPlatformBackend } from './backend.ts'
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
export { FOCUS_FALLBACK_FOREGROUND, FOCUS_NOTE } from './backend.ts'
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
 * Mount Computer Use with the host-platform backend.
 * When Desktop Host provides `computerUseOverlayGuard`, capture, inspect, listScreens, HID, and withGuiTurn run
 * inside overlay-guard intervals, `listScreens` waits for the observation-frame ribbon ack, and overlay-exclude
 * capture runs ScreenCaptureKit in the Electron process.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; omitted fields use schema defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const guard = ctx.get('computerUseOverlayGuard')
  const backend = createPlatformBackend(
    process.platform,
    guard?.captureExcludedRegion?.bind(guard),
  )
  applyComputerUse(ctx, guard === undefined ? backend : wrapDesktopBackend(backend, guard), resolveComputerUseConfig(config))
}
