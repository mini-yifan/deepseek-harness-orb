/**
 * Choose the Windows observation window from a z-order snapshot.
 * Native code supplies physical-pixel facts. This module does not call Win32.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/windows-foreground
 */

import type { WindowsRect } from './windows.ts'
import { CROSS_PID_TRANSIENT_PAD, MIN_LAYER0_WINDOW_EDGE } from './observation-limits.ts'

/** Top-level classes that are the shell, not an operable app. Taskbar, secondary taskbar, and the desktop. */
const SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Progman',
  'WorkerW',
])

/**
 * Top-level classes merged from another process when they intersect the owner.
 * `#32768` is the system menu. `ComboLBox` is the combo dropdown.
 */
const CROSS_PID_TRANSIENT_CLASSES = new Set(['#32768', 'ComboLBox'])

/** One top-level window in z-order, already in physical pixels. */
export interface WindowsWindowFact {
  readonly hwnd: number
  readonly pid: number
  /** `GW_OWNER`, or `0` when the window has no owner. */
  readonly ownerHwnd: number
  readonly className: string
  readonly appName: string
  readonly title: string
  readonly visible: boolean
  readonly iconic: boolean
  readonly cloaked: boolean
  /** `WS_EX_TOOLWINDOW`. Tool windows are not observation owners. */
  readonly toolWindow: boolean
  /** `WS_POPUP`. */
  readonly popup: boolean
  /** `DWMWA_EXTENDED_FRAME_BOUNDS`, else `GetWindowRect`. */
  readonly frame: WindowsRect
  /** Monitor rectangle that contains the window. */
  readonly monitor: WindowsRect
  /** Effective monitor DPI. `96` is scale 1. */
  readonly monitorDpi: number
}

/** Z-order snapshot `GetForegroundWindow` plus `EnumWindows` produce together. */
export interface WindowsDesktopSnapshot {
  /** `0` when no window is foreground. */
  readonly foregroundHwnd: number
  /** Top-down z-order. */
  readonly windows: readonly WindowsWindowFact[]
}

/** Owner window plus same-monitor transients, in physical pixels. */
export interface WindowsObservationSelection {
  readonly appName: string
  readonly windowTitle: string
  readonly bounds: WindowsRect
  readonly scale: number
  readonly windowId: number
  readonly transientWindowIds: readonly number[]
  /**
   * True when `foregroundHwnd` is this owner or one of `transientWindowIds`.
   * False when that hwnd was skipped and this owner is the next operable window.
   */
  readonly focused: boolean
}

function excludeSet(ids: readonly number[]): Set<number> {
  const exclude = new Set<number>()
  for (const id of ids) {
    if (Number.isInteger(id) && id > 0) exclude.add(id)
  }
  return exclude
}

function sameMonitor(left: WindowsWindowFact, right: WindowsWindowFact): boolean {
  return left.monitor.x === right.monitor.x
    && left.monitor.y === right.monitor.y
    && left.monitor.width === right.monitor.width
    && left.monitor.height === right.monitor.height
}

function intersects(left: WindowsRect, right: WindowsRect, pad: number): boolean {
  return left.x - pad < right.x + right.width
    && left.x + left.width + pad > right.x
    && left.y - pad < right.y + right.height
    && left.y + left.height + pad > right.y
}

function positiveFrame(frame: WindowsRect): boolean {
  return frame.width > 0 && frame.height > 0
}

/**
 * Whether `candidate`'s owner chain reaches `ownerHwnd`.
 * A cycle or a missing owner stops the walk.
 * @param byHwnd - facts indexed by hwnd.
 * @param candidate - window whose `GW_OWNER` chain is walked.
 * @param ownerHwnd - observation owner hwnd.
 * @returns true when an owner in the chain is `ownerHwnd`.
 */
function ownedBy(
  byHwnd: ReadonlyMap<number, WindowsWindowFact>,
  candidate: WindowsWindowFact,
  ownerHwnd: number,
): boolean {
  let current = candidate.ownerHwnd
  const seen = new Set<number>()
  while (current !== 0 && !seen.has(current)) {
    if (current === ownerHwnd) return true
    seen.add(current)
    current = byHwnd.get(current)?.ownerHwnd ?? 0
  }
  return false
}

function eligibleOwner(window: WindowsWindowFact, exclude: ReadonlySet<number>): boolean {
  if (exclude.has(window.hwnd)) return false
  if (!window.visible || window.iconic || window.cloaked || window.toolWindow) return false
  if (SHELL_CLASSES.has(window.className) || CROSS_PID_TRANSIENT_CLASSES.has(window.className)) return false
  if (window.frame.width < MIN_LAYER0_WINDOW_EDGE || window.frame.height < MIN_LAYER0_WINDOW_EDGE) return false
  return true
}

function includeTransient(
  candidate: WindowsWindowFact,
  owner: WindowsWindowFact,
  byHwnd: ReadonlyMap<number, WindowsWindowFact>,
): boolean {
  const samePid = candidate.pid === owner.pid
  if (samePid && ownedBy(byHwnd, candidate, owner.hwnd)) return true
  const hits = intersects(owner.frame, candidate.frame, CROSS_PID_TRANSIENT_PAD)
  if (samePid && candidate.popup && hits) return true
  return !samePid && CROSS_PID_TRANSIENT_CLASSES.has(candidate.className) && hits
}

/**
 * Pick the foreground window, or the next eligible top-level window, and union same-monitor transients.
 * Overlay hwnds in `excludeWindowIds` are skipped. Shell classes and system menus are not owners.
 * Same-process windows join when they are owned by that window or are an intersecting popup.
 * Another process joins only for an intersecting system menu or combo dropdown.
 * `focused` is true only when the foreground hwnd is the owner or one of those transients.
 * @param snapshot - physical-pixel z-order snapshot.
 * @param excludeWindowIds - overlay hwnds from the capture cloak. Non-positive and non-integer ids are ignored.
 * @returns the observation, or undefined when no operable window remains.
 */
export function selectWindowsObservation(
  snapshot: WindowsDesktopSnapshot,
  excludeWindowIds: readonly number[],
): WindowsObservationSelection | undefined {
  const exclude = excludeSet(excludeWindowIds)
  const foreground = snapshot.windows.find(window => window.hwnd === snapshot.foregroundHwnd)
  const owner = foreground !== undefined && eligibleOwner(foreground, exclude)
    ? foreground
    : snapshot.windows.find(window => eligibleOwner(window, exclude))
  if (owner === undefined) return undefined
  const byHwnd = new Map(snapshot.windows.map(window => [window.hwnd, window]))
  let minX = owner.frame.x
  let minY = owner.frame.y
  let maxX = owner.frame.x + owner.frame.width
  let maxY = owner.frame.y + owner.frame.height
  const transientWindowIds: number[] = []
  for (const candidate of snapshot.windows) {
    if (candidate.hwnd === owner.hwnd || exclude.has(candidate.hwnd)) continue
    if (!candidate.visible || candidate.iconic || candidate.cloaked) continue
    if (SHELL_CLASSES.has(candidate.className) || !positiveFrame(candidate.frame)) continue
    if (!sameMonitor(candidate, owner)) continue
    if (!includeTransient(candidate, owner, byHwnd)) continue
    transientWindowIds.push(candidate.hwnd)
    if (candidate.frame.x < minX) minX = candidate.frame.x
    if (candidate.frame.y < minY) minY = candidate.frame.y
    if (candidate.frame.x + candidate.frame.width > maxX) maxX = candidate.frame.x + candidate.frame.width
    if (candidate.frame.y + candidate.frame.height > maxY) maxY = candidate.frame.y + candidate.frame.height
  }
  return {
    appName: owner.appName,
    windowTitle: owner.title.trim(),
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    scale: owner.monitorDpi > 0 ? owner.monitorDpi / 96 : 1,
    windowId: owner.hwnd,
    transientWindowIds,
    focused: snapshot.foregroundHwnd === owner.hwnd || transientWindowIds.includes(snapshot.foregroundHwnd),
  }
}
