/**
 * Windows selection events for the existing toolbar controller.
 * The low-level hooks live in {@link startWindowsSelectionHooks}; tests dispatch events directly.
 * @module @deepseek-ai/dsh-desktop/src/windows-selection
 */

import type { SelectionHelperEvent, SelectionMonitor, SelectionMonitorHandlers } from './selection-monitor.ts'

/** Pointer and key messages already converted to Electron DIP coordinates. */
export type WindowsSelectionMessage =
  | { readonly type: 'mouse-down'; readonly x: number; readonly y: number; readonly button: 'left' | 'right' | 'middle' }
  | { readonly type: 'mouse-up'; readonly x: number; readonly y: number; readonly button: 'left' | 'right' | 'middle' }
  | { readonly type: 'wheel' }
  | { readonly type: 'key' }

/** How the monitor reads a selection and activates a process. */
export interface WindowsSelectionProbe {
  readSelection(): Promise<{
    readonly text: string
    readonly pid?: number
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  } | undefined>
  activatePid(pid: number): void
}

/**
 * Translate one hook message into toolbar events.
 * A left mouse-up also asks `probe` for the selected text.
 * @param message - pointer or key message.
 * @param handlers - toolbar sink.
 * @param probe - selection reader.
 * @param excluded - process ids whose selections are ignored.
 */
export function dispatchWindowsSelectionMessage(
  message: WindowsSelectionMessage,
  handlers: SelectionMonitorHandlers,
  probe: WindowsSelectionProbe,
  excluded: ReadonlySet<number>,
): void {
  if (message.type === 'key' || message.type === 'wheel') {
    handlers.onEvent({ type: message.type === 'key' ? 'key' : 'dismiss' })
    return
  }
  if (message.button !== 'left') {
    handlers.onEvent({ type: 'dismiss' })
    return
  }
  handlers.onEvent({ type: message.type, x: message.x, y: message.y })
  if (message.type !== 'mouse-up') return
  void probe.readSelection().then((selection) => {
    if (selection === undefined || selection.text.trim() === '') return
    if (selection.pid !== undefined && excluded.has(selection.pid)) return
    const event: SelectionHelperEvent = {
      type: 'selection',
      text: selection.text,
      ...selection.pid === undefined ? {} : { pid: selection.pid },
      ...selection.x === undefined || selection.y === undefined ? {} : { x: selection.x, y: selection.y },
      ...selection.x === undefined || selection.y === undefined
        || selection.width === undefined || selection.height === undefined
        ? {}
        : { bounds: { x: selection.x, y: selection.y, width: selection.width, height: selection.height } },
    }
    handlers.onEvent(event)
  }).catch(() => {
    // A failed UI Automation read leaves the toolbar hidden.
  })
}

/**
 * Start a selection monitor that reports `ready` immediately.
 * @param handlers - toolbar sink.
 * @param probe - selection reader and activation.
 * @param install - registers hooks and returns an unhook function.
 * @returns a monitor the toolbar controller can stop and exclude.
 */
export function startWindowsSelectionMonitor(
  handlers: SelectionMonitorHandlers,
  probe: WindowsSelectionProbe,
  install: (dispatch: (message: WindowsSelectionMessage) => void) => () => void,
): SelectionMonitor {
  const excluded = new Set<number>()
  let lastFront: number | undefined
  const tracking: WindowsSelectionProbe = {
    readSelection: () => probe.readSelection().then((selection) => {
      if (selection?.pid !== undefined && !excluded.has(selection.pid)) lastFront = selection.pid
      return selection
    }),
    activatePid: (pid) => { probe.activatePid(pid) },
  }
  handlers.onEvent({ type: 'ready' })
  let unhook = (): void => undefined
  try {
    unhook = install((message) => { dispatchWindowsSelectionMessage(message, handlers, tracking, excluded) })
  } catch (error: unknown) {
    console.error('dsh desktop: selection hook failed', error)
  }
  return {
    stop() { unhook() },
    setExcludePids(pids) {
      excluded.clear()
      for (const pid of pids) excluded.add(pid)
    },
    activatePid(pid) {
      if (excluded.has(pid)) return
      probe.activatePid(pid)
    },
    lastFrontPid() {
      return lastFront
    },
  }
}
