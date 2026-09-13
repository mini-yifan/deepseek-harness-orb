/**
 * Experimental Computer Use plugin: five exclusive GUI tools plus a first-turn screenshot.
 * Observation rides existing `user/message` and `tool/result` events; there is no screenshot tool.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use
 */

import type { Context } from '@deepseek-ai/cordis'
import { createPlatformBackend } from './backend.ts'
import { Config, resolveComputerUseConfig } from './config.ts'
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
  DesktopBackend,
  HotkeyInput,
  ScreenInfo,
  ScrollInput,
  TypeInput,
} from './backend.ts'
export { Config, resolveComputerUseConfig } from './config.ts'
export type { ResolvedComputerUseConfig } from './config.ts'
export { createFakeDesktopBackend, FAKE_DESKTOP_PNG } from './fake.ts'
export type { FakeDesktopAction, FakeDesktopBackend, FakeDesktopOptions } from './fake.ts'
export { applyComputerUse, PLUGIN_NAME, POLICY_SECTION_ORDER } from './plugin.ts'
export { POLICY } from './policy.ts'

/** Cordis plugin name. */
export const name = PLUGIN_NAME

/** Services required at apply time. Missing attachments keep the plugin pending. */
export const inject = ['tools', 'systemPrompt', 'attachments']

/**
 * Mount Computer Use with the host-platform backend.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; omitted fields use schema defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applyComputerUse(ctx, createPlatformBackend(), resolveComputerUseConfig(config))
}
