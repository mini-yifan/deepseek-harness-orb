/**
 * Low-level Win32 mouse and keyboard hooks plus UI Automation selection reads.
 * @module @deepseek-ai/dsh-desktop/src/windows-selection-native
 */

import { execFile } from 'node:child_process'
import koffi from 'koffi'
import type { WindowsSelectionMessage, WindowsSelectionProbe } from './windows-selection.ts'

const WH_KEYBOARD_LL = 13
const WH_MOUSE_LL = 14
const WM_KEYDOWN = 0x0100
const WM_SYSKEYDOWN = 0x0104
const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202
const WM_RBUTTONDOWN = 0x0204
const WM_RBUTTONUP = 0x0205
const WM_MBUTTONDOWN = 0x0207
const WM_MBUTTONUP = 0x0208
const WM_MOUSEWHEEL = 0x020A
const MONITOR_DEFAULTTONEAREST = 2

const POINT = koffi.struct('DSH_SEL_POINT', { x: 'int32', y: 'int32' })
const MSLLHOOKSTRUCT = koffi.struct('DSH_SEL_MSLL', {
  pt: POINT,
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const HOOKPROC = koffi.proto('intptr __stdcall DshSelHookProc(int nCode, uintptr wParam, intptr lParam)')

const SELECTION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { return }
$pattern = $null
if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return }
$ranges = @($pattern.GetSelection())
if ($ranges.Length -lt 1) { return }
$text = $ranges[0].GetText(4000)
if ([string]::IsNullOrWhiteSpace($text)) { return }
$rects = @($ranges[0].GetBoundingRectangles())
$x = 0; $y = 0; $width = 0; $height = 0
if ($rects.Length -ge 4) { $x = $rects[0]; $y = $rects[1]; $width = $rects[2]; $height = $rects[3] }
[pscustomobject]@{
  text = $text; x = $x; y = $y; width = $width; height = $height; pid = $focused.Current.ProcessId
} | ConvertTo-Json -Compress
`

function dip(user32: ReturnType<typeof koffi.load>, shcore: ReturnType<typeof koffi.load>, x: number, y: number): { x: number; y: number } {
  const monitorFromPoint = user32.func(
    'void * __stdcall MonitorFromPoint(DSH_SEL_POINT pt, uint32 dwFlags)',
  )
  const monitor = monitorFromPoint({ x, y }, MONITOR_DEFAULTTONEAREST)
  const dpiX = [0]
  const dpiY = [0]
  const dpiForMonitor = shcore.func(
    'int __stdcall GetDpiForMonitor(void *hmonitor, int dpiType, _Out_ uint32 *dpiX, _Out_ uint32 *dpiY)',
  )
  if (dpiForMonitor(monitor, 0, dpiX, dpiY) !== 0) {
    return { x, y }
  }
  const scale = (dpiX[0] ?? 96) / 96
  if (!Number.isFinite(scale) || scale <= 0) return { x, y }
  return { x: x / scale, y: y / scale }
}

/**
 * Read the focused control's selected text with UI Automation.
 * @returns the selection, or undefined when nothing is selected.
 */
export function readWindowsSelection(): Promise<Awaited<ReturnType<WindowsSelectionProbe['readSelection']>>> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', SELECTION_SCRIPT], {
      timeout: 1500,
      windowsHide: true,
    }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined)
        return
      }
      try {
        const parsed: unknown = JSON.parse(stdout)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          resolve(undefined)
          return
        }
        const record = parsed as Record<string, unknown>
        if (typeof record.text !== 'string') {
          resolve(undefined)
          return
        }
        resolve({
          text: record.text,
          ...typeof record.pid === 'number' ? { pid: record.pid } : {},
          ...typeof record.x === 'number' ? { x: record.x } : {},
          ...typeof record.y === 'number' ? { y: record.y } : {},
          ...typeof record.width === 'number' ? { width: record.width } : {},
          ...typeof record.height === 'number' ? { height: record.height } : {},
        })
      } catch {
        resolve(undefined)
      }
    })
  })
}

/**
 * Activate a top-level window owned by `pid`.
 * @param pid - process to bring forward.
 */
export function activateWindowsPid(pid: number): void {
  const user32 = koffi.load('user32.dll')
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hWnd)')
  const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hWnd)')
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)')
  const enumProc = koffi.proto('int __stdcall DshSelEnumProc(void *hwnd, intptr lParam)')
  let found = false
  const callback = koffi.register((hwnd: unknown) => {
    if (found || IsWindowVisible(hwnd) === 0) return 1
    const slot = [0]
    GetWindowThreadProcessId(hwnd, slot)
    if (slot[0] === pid) {
      SetForegroundWindow(hwnd)
      found = true
    }
    return 1
  }, koffi.pointer(enumProc))
  try {
    user32.func('int __stdcall EnumWindows(DshSelEnumProc *cb, intptr lParam)')(callback, 0)
  } finally {
    koffi.unregister(callback)
  }
}

/**
 * Install low-level mouse and keyboard hooks on this thread.
 * @param dispatch - receives DIP pointer and key messages.
 * @returns a function that removes both hooks.
 */
export function installWindowsSelectionHooks(dispatch: (message: WindowsSelectionMessage) => void): () => void {
  const user32 = koffi.load('user32.dll')
  const shcore = koffi.load('shcore.dll')
  const CallNextHookEx = user32.func(
    'intptr __stdcall CallNextHookEx(void *hhk, int nCode, uintptr wParam, intptr lParam)',
  )
  const SetWindowsHookExW = user32.func(
    'void * __stdcall SetWindowsHookExW(int idHook, DshSelHookProc *lpfn, void *hMod, uint32 dwThreadId)',
  )
  const UnhookWindowsHookEx = user32.func('int __stdcall UnhookWindowsHookEx(void *hhk)')
  const hooks: unknown[] = []
  const callbacks: unknown[] = []

  const mouse = koffi.register((code: number, wParam: number | bigint, lParam: unknown) => {
    try {
      if (code >= 0) {
        const info = koffi.decode(lParam, MSLLHOOKSTRUCT) as { pt: { x: number; y: number } }
        const point = dip(user32, shcore, info.pt.x, info.pt.y)
        const kind = Number(wParam)
        if (kind === WM_MOUSEWHEEL) dispatch({ type: 'wheel' })
        else if (kind === WM_LBUTTONDOWN) dispatch({ type: 'mouse-down', ...point, button: 'left' })
        else if (kind === WM_LBUTTONUP) dispatch({ type: 'mouse-up', ...point, button: 'left' })
        else if (kind === WM_RBUTTONDOWN || kind === WM_RBUTTONUP) dispatch({ type: 'mouse-down', ...point, button: 'right' })
        else if (kind === WM_MBUTTONDOWN || kind === WM_MBUTTONUP) dispatch({ type: 'mouse-down', ...point, button: 'middle' })
      }
    } catch {
      // A hook fault must not swallow the rest of the mouse chain.
    }
    return CallNextHookEx(null, code, wParam, lParam)
  }, koffi.pointer(HOOKPROC))
  callbacks.push(mouse)
  hooks.push(SetWindowsHookExW(WH_MOUSE_LL, mouse, null, 0))

  const keyboard = koffi.register((code: number, wParam: number | bigint, lParam: unknown) => {
    try {
      if (code >= 0) {
        const kind = Number(wParam)
        if (kind === WM_KEYDOWN || kind === WM_SYSKEYDOWN) dispatch({ type: 'key' })
      }
    } catch {
      // A hook fault must not swallow the rest of the keyboard chain.
    }
    return CallNextHookEx(null, code, wParam, lParam)
  }, koffi.pointer(HOOKPROC))
  callbacks.push(keyboard)
  hooks.push(SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, null, 0))

  return () => {
    for (const hook of hooks) {
      if (hook !== null && hook !== undefined) UnhookWindowsHookEx(hook)
    }
    for (const callback of callbacks) koffi.unregister(callback as bigint)
  }
}

/**
 * Production probe used by the Desktop main process.
 * @returns UI Automation reads and Win32 activation.
 */
export function productionSelectionProbe(): WindowsSelectionProbe {
  return {
    readSelection: readWindowsSelection,
    activatePid: activateWindowsPid,
  }
}
