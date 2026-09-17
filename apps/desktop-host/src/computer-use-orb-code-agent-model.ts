/**
 * Desktop Host plugin that holds the floating-ball background Code-agent model selection.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-orb-code-agent-model
 */

import type { Context } from '@deepseek-ai/cordis'

/** One provider/model route stored for new `code_agent` sessions. */
export interface OrbCodeAgentModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Live background Code-agent model selection for Computer Use `code_agent` create. */
export interface OrbCodeAgentModel {
  /** @returns the latest Electron-pushed selection, or undefined before the first push. */
  currentSelection(): OrbCodeAgentModelSelection | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Desktop overlay background Code-agent model selection. */
    orbCodeAgentModel: OrbCodeAgentModel
  }
}

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-orb-code-agent-model'

let selection: OrbCodeAgentModelSelection | undefined

/**
 * Replace the stored background Code-agent selection.
 * @param next - Electron-pushed route.
 */
export function setOrbCodeAgentModelSelection(next: OrbCodeAgentModelSelection): void {
  selection = {
    provider: next.provider,
    model: next.model,
    ...(next.reasoningEffort === undefined ? {} : { reasoningEffort: next.reasoningEffort }),
  }
}

/**
 * Drop the stored selection. Tests reset module state between cases.
 * @returns nothing; module state is undefined afterwards.
 */
export function clearOrbCodeAgentModelSelection(): void {
  selection = undefined
}

/**
 * Publish the background Code-agent model selection for `code_agent` create.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.provide('orbCodeAgentModel', {
    currentSelection: () => selection,
  })
}
