/** Persist selection-toolbar enablement and translate language in the Desktop profile. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SelectionTranslateLanguage } from './selection-prompt.ts'

/** Profile-relative JSON file holding selection-toolbar preferences. */
export const SELECTION_TOOLBAR_FILE = 'selection-toolbar.json'

/** Stored selection-toolbar preferences. */
export interface SelectionToolbarConfig {
  readonly enabled: boolean
  readonly translateTargetLanguage: SelectionTranslateLanguage
}

const DEFAULT_CONFIG: SelectionToolbarConfig = {
  enabled: true,
  translateTargetLanguage: 'zh',
}

function isLanguage(value: unknown): value is SelectionTranslateLanguage {
  return value === 'zh' || value === 'en'
}

/**
 * Read selection-toolbar preferences.
 * @param profileDir - Desktop profile directory.
 * @returns stored values, or the shipped defaults when absent or invalid.
 */
export function readSelectionToolbarConfig(profileDir: string): SelectionToolbarConfig {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, SELECTION_TOOLBAR_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_CONFIG
    const record = value as { enabled?: unknown; translateTargetLanguage?: unknown }
    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_CONFIG.enabled,
      translateTargetLanguage: isLanguage(record.translateTargetLanguage)
        ? record.translateTargetLanguage
        : DEFAULT_CONFIG.translateTargetLanguage,
    }
  } catch {
    // Missing or invalid profile JSON uses shipped defaults.
    return DEFAULT_CONFIG
  }
}

/**
 * Persist selection-toolbar preferences.
 * @param profileDir - Desktop profile directory.
 * @param config - values to write.
 */
export function writeSelectionToolbarConfig(profileDir: string, config: SelectionToolbarConfig): void {
  writeFileSync(
    join(profileDir, SELECTION_TOOLBAR_FILE),
    `${JSON.stringify({
      enabled: config.enabled,
      translateTargetLanguage: config.translateTargetLanguage,
    }, undefined, 2)}\n`,
  )
}
