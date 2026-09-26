/** Parse selection-monitor NDJSON and start the in-process Electron or Windows hook binding. */

import { loadMacosSelectionBinding, type MacosSelectionNapiBinding } from './macos-selection-napi.ts'
import { installWindowsSelectionHooks, productionSelectionProbe } from './windows-selection-native.ts'
import { startWindowsSelectionMonitor } from './windows-selection.ts'

/** Selection rectangle in Electron screen coordinates (top-left origin). */
export interface SelectionBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One event from the selection helper stdout protocol. */
export type SelectionHelperEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'untrusted' }
  | { readonly type: 'mouse-down'; readonly x: number; readonly y: number }
  | { readonly type: 'mouse-up'; readonly x: number; readonly y: number }
  | { readonly type: 'key' }
  /** Right-click, middle-click, or non-momentum scroll; hides without hit-testing the toolbar. */
  | { readonly type: 'dismiss' }
  | {
    readonly type: 'selection'
    readonly text: string
    readonly bounds?: SelectionBounds
    readonly x?: number
    readonly y?: number
    readonly pid?: number
    readonly bundle?: string
  }

/** Callbacks invoked on the Electron main thread. */
export interface SelectionMonitorHandlers {
  readonly onEvent: (event: SelectionHelperEvent) => void
}

/** Running helper handle. */
export interface SelectionMonitor {
  stop(): void
  setExcludePids(pids: readonly number[]): void
  /**
   * Re-activate the process that owned the last selection.
   * @param pid - target process id. Electron and helper pids are ignored by the helper.
   */
  activatePid(pid: number): void
  /**
   * Last frontmost process that is not Electron.
   * @returns the pid, or undefined when the monitor has not seen another app.
   */
  lastFrontPid(): number | undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseBounds(value: unknown): SelectionBounds | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)
    || !isFiniteNumber(record.width) || !isFiniteNumber(record.height)) {
    return undefined
  }
  return { x: record.x, y: record.y, width: record.width, height: record.height }
}

/**
 * Parse one NDJSON line from the Darwin selection helper.
 * @param line - a complete stdout line without the trailing newline.
 * @returns a typed event, or undefined when the line is not a known payload.
 */
export function parseSelectionHelperLine(line: string): SelectionHelperEvent | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed) as unknown
  } catch {
    // Helper stdout is not a protocol line.
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'untrusted':
      return { type: 'untrusted' }
    case 'key':
      return { type: 'key' }
    case 'dismiss':
      return { type: 'dismiss' }
    case 'mouse-down':
    case 'mouse-up':
      if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) return undefined
      return { type: record.type, x: record.x, y: record.y }
    case 'selection': {
      if (typeof record.text !== 'string' || record.text.trim() === '') return undefined
      const bounds = parseBounds(record.bounds)
      return {
        type: 'selection',
        text: record.text,
        ...bounds === undefined ? {} : { bounds },
        ...isFiniteNumber(record.x) ? { x: record.x } : {},
        ...isFiniteNumber(record.y) ? { y: record.y } : {},
        ...isFiniteNumber(record.pid) ? { pid: record.pid } : {},
        ...typeof record.bundle === 'string' ? { bundle: record.bundle } : {},
      }
    }
    default:
      return undefined
  }
}

/**
 * Start the Darwin selection monitor in this Electron process when the addon exists.
 * @param handlers - event sink.
 * @returns a running monitor, or undefined when the addon is missing or not Darwin.
 */
export function startSelectionMonitor(handlers: SelectionMonitorHandlers): SelectionMonitor | undefined {
  if (process.platform === 'win32') {
    return startWindowsSelectionMonitor(handlers, productionSelectionProbe(), installWindowsSelectionHooks)
  }
  if (process.platform !== 'darwin') return undefined
  let addon: MacosSelectionNapiBinding
  try {
    addon = loadMacosSelectionBinding()
  } catch (error) {
    // Addon is not next to this module: unit tests import `src/`, and non-Darwin stubs are not loadable.
    console.warn('desktop selection: monitor did not load', error)
    return undefined
  }
  addon.start((line) => {
    const event = parseSelectionHelperLine(line)
    if (event !== undefined) handlers.onEvent(event)
  })
  return {
    stop() {
      addon.stop()
    },
    setExcludePids(pids) {
      addon.excludePids(pids.map(String).join(','))
    },
    activatePid(pid) {
      addon.activatePid(pid)
    },
    lastFrontPid() {
      const pid = addon.lastFrontPid()
      return pid > 0 ? pid : undefined
    },
  }
}
