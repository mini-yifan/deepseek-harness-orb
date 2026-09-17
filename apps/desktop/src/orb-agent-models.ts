/** Persist floating-ball overlay and background Code-agent model selections. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding orb Agent model selections. */
export const ORB_AGENT_MODELS_FILE = 'orb-agent-models.json'

/** One provider/model route, with optional reasoning effort. */
export interface OrbAgentModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Independent overlay Computer Use and background `code_agent` selections. */
export interface OrbAgentModels {
  readonly overlay: OrbAgentModelSelection
  readonly background: OrbAgentModelSelection
}

/** Shipped overlay and background default: DeepSeek-V41-Flash at Max. */
export const DEFAULT_ORB_AGENT_MODEL: OrbAgentModelSelection = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  reasoningEffort: 'max',
}

const DEFAULT_MODELS: OrbAgentModels = {
  overlay: DEFAULT_ORB_AGENT_MODEL,
  background: DEFAULT_ORB_AGENT_MODEL,
}

function parseSelection(value: unknown, fallback: OrbAgentModelSelection): OrbAgentModelSelection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
  const record = value as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
  if (typeof record.provider !== 'string' || record.provider === ''
    || typeof record.model !== 'string' || record.model === '') {
    return fallback
  }
  if (record.reasoningEffort !== undefined
    && (typeof record.reasoningEffort !== 'string' || record.reasoningEffort === '')) {
    return fallback
  }
  return {
    provider: record.provider,
    model: record.model,
    ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: record.reasoningEffort }),
  }
}

/**
 * Read overlay and background model selections.
 * @param profileDir - Desktop profile directory.
 * @returns stored values, or the shipped defaults when absent or invalid.
 */
export function readOrbAgentModels(profileDir: string): OrbAgentModels {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, ORB_AGENT_MODELS_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_MODELS
    const record = value as { overlay?: unknown; background?: unknown }
    return {
      overlay: parseSelection(record.overlay, DEFAULT_ORB_AGENT_MODEL),
      background: parseSelection(record.background, DEFAULT_ORB_AGENT_MODEL),
    }
  } catch {
    // Missing or invalid profile JSON uses shipped defaults.
    return DEFAULT_MODELS
  }
}

/**
 * Persist overlay and background model selections.
 * @param profileDir - Desktop profile directory.
 * @param models - values to write.
 */
export function writeOrbAgentModels(profileDir: string, models: OrbAgentModels): void {
  writeFileSync(
    join(profileDir, ORB_AGENT_MODELS_FILE),
    `${JSON.stringify({
      overlay: serializeSelection(models.overlay),
      background: serializeSelection(models.background),
    }, undefined, 2)}\n`,
  )
}

function serializeSelection(selection: OrbAgentModelSelection): OrbAgentModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }
}
