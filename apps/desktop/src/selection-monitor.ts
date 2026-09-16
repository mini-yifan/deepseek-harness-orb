/** Spawn and parse the Darwin selection helper that watches drag-selects. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

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
 * Absolute path of the Darwin selection helper next to the bundled main script.
 * Packaged asar builds look in the matching `app.asar.unpacked` tree.
 * @returns a path that may or may not exist yet.
 */
export function macosSelectionHelperPath(): string {
  const adjacent = fileURLToPath(new URL('./macos-selection', import.meta.url))
  if (existsSync(adjacent)) return adjacent
  return adjacent.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

/**
 * Spawn the Darwin selection helper when the binary exists.
 * @param handlers - event sink.
 * @returns a running monitor, or undefined when the helper is missing or not Darwin.
 */
export function startSelectionMonitor(handlers: SelectionMonitorHandlers): SelectionMonitor | undefined {
  if (process.platform !== 'darwin') return undefined
  const helper = macosSelectionHelperPath()
  if (!existsSync(helper)) return undefined
  const child: ChildProcessWithoutNullStreams = spawn(helper, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      const event = parseSelectionHelperLine(line)
      if (event !== undefined) handlers.onEvent(event)
      newline = buffer.indexOf('\n')
    }
  })
  return {
    stop() {
      if (child.killed) return
      child.kill()
    },
    setExcludePids(pids) {
      writeHelperCommand(child, { type: 'exclude-pids', pids: [...pids] })
    },
    activatePid(pid) {
      writeHelperCommand(child, { type: 'activate-pid', pid })
    },
  }
}

function writeHelperCommand(child: ChildProcessWithoutNullStreams, command: unknown): void {
  if (child.killed || child.stdin.destroyed) return
  try {
    child.stdin.write(`${JSON.stringify(command)}\n`)
  } catch {
    // Helper already exited; stop() owns teardown.
  }
}
