/**
 * Win32 capture and input used by {@link createWindowsDesktopBackend}.
 * Loaded only on Windows, and only when a method runs without injected operations.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/windows-native
 */

import { execFileSync } from 'node:child_process'
import koffi from 'koffi'
import { encodeBgraPng, type WindowsDesktopOps, type WindowsForeground, type WindowsRect } from './windows.ts'

const SRCCOPY = 0x00CC0020
const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_ABSOLUTE = 0x8000
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const CF_UNICODETEXT = 13
const GMEM_MOVEABLE = 0x0002
const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const TOKEN_QUERY = 0x0008
const TokenIntegrityLevel = 25
const SW_SHOWNORMAL = 1

const RECT = koffi.struct('DSH_CU_RECT', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
})

const BITMAPINFOHEADER = koffi.struct('DSH_CU_BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32',
})

const MOUSEINPUT = koffi.struct('DSH_CU_MOUSEINPUT', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const KEYBDINPUT = koffi.struct('DSH_CU_KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const INPUT_UNION = koffi.union('DSH_CU_INPUT_UNION', {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT,
})

const INPUT = koffi.struct('DSH_CU_INPUT', {
  type: 'uint32',
  u: INPUT_UNION,
})

// String prototypes below refer to these registered layouts by name.
void RECT
void BITMAPINFOHEADER

interface NativeRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface NativeBindings {
  readonly user32: ReturnType<typeof koffi.load>
  readonly gdi32: ReturnType<typeof koffi.load>
  readonly kernel32: ReturnType<typeof koffi.load>
  readonly shell32: ReturnType<typeof koffi.load>
  readonly advapi32: ReturnType<typeof koffi.load>
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined || value === 0 || value === 0n
}

function hwndId(value: unknown): number | undefined {
  const id = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  if (!Number.isSafeInteger(id) || id === 0) return undefined
  return id
}

function bind(libraries: NativeBindings): {
  GetForegroundWindow: () => unknown
  GetWindowRect: (hwnd: unknown, rect: NativeRect) => number
  GetWindowTextLengthW: (hwnd: unknown) => number
  GetWindowTextW: (hwnd: unknown, buffer: Buffer, max: number) => number
  GetWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number
  IsWindowVisible: (hwnd: unknown) => number
  EnumWindows: (callback: unknown, param: number) => number
  GetDpiForWindow: (hwnd: unknown) => number
  GetSystemMetrics: (index: number) => number
  GetDC: (hwnd: unknown) => unknown
  ReleaseDC: (hwnd: unknown, hdc: unknown) => number
  CreateCompatibleDC: (hdc: unknown) => unknown
  CreateCompatibleBitmap: (hdc: unknown, width: number, height: number) => unknown
  SelectObject: (hdc: unknown, object: unknown) => unknown
  BitBlt: (dest: unknown, x: number, y: number, w: number, h: number, src: unknown, sx: number, sy: number, rop: number) => number
  GetDIBits: (
    hdc: unknown,
    bitmap: unknown,
    start: number,
    lines: number,
    bits: Buffer,
    header: Record<string, number>,
    usage: number,
  ) => number
  DeleteObject: (object: unknown) => number
  DeleteDC: (hdc: unknown) => number
  SendInput: (count: number, inputs: unknown[], size: number) => number
  OpenClipboard: (hwnd: unknown) => number
  EmptyClipboard: () => number
  SetClipboardData: (format: number, memory: unknown) => unknown
  CloseClipboard: () => number
  GetClipboardData: (format: number) => unknown
  GlobalAlloc: (flags: number, bytes: number) => unknown
  GlobalLock: (memory: unknown) => unknown
  GlobalUnlock: (memory: unknown) => number
  GlobalSize: (memory: unknown) => number
  RtlMoveMemory: (dest: unknown, source: unknown, bytes: number) => void
  OpenProcess: (access: number, inherit: number, pid: number) => unknown
  CloseHandle: (handle: unknown) => number
  QueryFullProcessImageNameW: (process: unknown, flags: number, buffer: Buffer, size: number[]) => number
  OpenProcessToken: (process: unknown, access: number, token: unknown[]) => number
  GetTokenInformation: (token: unknown, cls: number, buffer: Buffer | null, size: number, needed: number[]) => number
  GetSidSubAuthorityCount: (sid: unknown) => unknown
  GetSidSubAuthority: (sid: unknown, index: number) => unknown
  ShellExecuteW: (hwnd: unknown, verb: string | null, file: string, params: string | null, dir: string | null, show: number) => unknown
  enumProc: ReturnType<typeof koffi.proto>
} {
  const { user32, gdi32, kernel32, shell32, advapi32 } = libraries
  const enumProc = koffi.proto('int __stdcall DshCuEnumWindowsProc(void *hwnd, intptr lParam)')
  return {
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowRect: user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ DSH_CU_RECT *lpRect)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, uint16_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'),
    IsWindowVisible: user32.func('int __stdcall IsWindowVisible(void *hWnd)'),
    EnumWindows: user32.func('int __stdcall EnumWindows(DshCuEnumWindowsProc *lpEnumFunc, intptr lParam)'),
    GetDpiForWindow: user32.func('uint32 __stdcall GetDpiForWindow(void *hwnd)'),
    GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int nIndex)'),
    GetDC: user32.func('void * __stdcall GetDC(void *hWnd)'),
    ReleaseDC: user32.func('int __stdcall ReleaseDC(void *hWnd, void *hDC)'),
    CreateCompatibleDC: gdi32.func('void * __stdcall CreateCompatibleDC(void *hdc)'),
    CreateCompatibleBitmap: gdi32.func('void * __stdcall CreateCompatibleBitmap(void *hdc, int cx, int cy)'),
    SelectObject: gdi32.func('void * __stdcall SelectObject(void *hdc, void *h)'),
    BitBlt: gdi32.func(
      'int __stdcall BitBlt(void *hdc, int x, int y, int cx, int cy, void *hdcSrc, int x1, int y1, uint32 rop)',
    ),
    GetDIBits: gdi32.func(
      'int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, '
      + '_Out_ uint8_t *lpvBits, _Inout_ DSH_CU_BITMAPINFOHEADER *lpbmi, uint32 usage)',
    ),
    DeleteObject: gdi32.func('int __stdcall DeleteObject(void *ho)'),
    DeleteDC: gdi32.func('int __stdcall DeleteDC(void *hdc)'),
    SendInput: user32.func('uint32 __stdcall SendInput(uint32 cInputs, DSH_CU_INPUT *pInputs, int cbSize)'),
    OpenClipboard: user32.func('int __stdcall OpenClipboard(void *hWndNewOwner)'),
    EmptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
    SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32 uFormat, void *hMem)'),
    CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
    GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32 uFormat)'),
    GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32 uFlags, uintptr dwBytes)'),
    GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *hMem)'),
    GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(void *hMem)'),
    GlobalSize: kernel32.func('uintptr __stdcall GlobalSize(void *hMem)'),
    RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(void *Destination, void *Source, uintptr Length)'),
    OpenProcess: kernel32.func(
      'void * __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)',
    ),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *hObject)'),
    QueryFullProcessImageNameW: kernel32.func(
      'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, '
      + 'uint16_t *lpExeName, _Inout_ uint32 *lpdwSize)',
    ),
    OpenProcessToken: advapi32.func(
      'int __stdcall OpenProcessToken(void *ProcessHandle, uint32 DesiredAccess, _Out_ void **TokenHandle)',
    ),
    GetTokenInformation: advapi32.func(
      'int __stdcall GetTokenInformation(void *TokenHandle, int TokenInformationClass, '
      + '_Out_ uint8_t *TokenInformation, uint32 TokenInformationLength, _Out_ uint32 *ReturnLength)',
    ),
    GetSidSubAuthorityCount: advapi32.func('uint8_t * __stdcall GetSidSubAuthorityCount(void *pSid)'),
    GetSidSubAuthority: advapi32.func(
      'uint32 * __stdcall GetSidSubAuthority(void *pSid, uint32 nSubAuthority)',
    ),
    ShellExecuteW: shell32.func(
      'intptr __stdcall ShellExecuteW(void *hwnd, str16 lpOperation, str16 lpFile, '
      + 'str16 lpParameters, str16 lpDirectory, int nShowCmd)',
    ),
    enumProc,
  }
}

type Bindings = ReturnType<typeof bind>

function windowText(api: Bindings, hwnd: unknown): string {
  const length = api.GetWindowTextLengthW(hwnd)
  if (length <= 0) return ''
  const buffer = Buffer.alloc((length + 1) * 2)
  api.GetWindowTextW(hwnd, buffer, length + 1)
  return buffer.toString('utf16le', 0, length * 2)
}

function pidOf(api: Bindings, hwnd: unknown): number {
  const pid = [0]
  api.GetWindowThreadProcessId(hwnd, pid)
  return pid[0] ?? 0
}

function processBaseName(api: Bindings, pid: number): string | undefined {
  if (pid === 0) return undefined
  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (isNull(handle)) return undefined
  try {
    const chars = Buffer.alloc(1024 * 2)
    const size = [1024]
    if (api.QueryFullProcessImageNameW(handle, 0, chars, size) === 0) return undefined
    const count = size[0] ?? 0
    const full = chars.toString('utf16le', 0, count * 2)
    const base = full.split(/[\\/]/u).at(-1) ?? full
    return base.replace(/\.exe$/iu, '')
  } finally {
    api.CloseHandle(handle)
  }
}

function integrityRid(api: Bindings, pid: number): number | undefined {
  try {
    return integrityRidUnchecked(api, pid)
  } catch {
    return undefined
  }
}

function integrityRidUnchecked(api: Bindings, pid: number): number | undefined {
  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (isNull(handle)) return undefined
  const token: unknown[] = [null]
  try {
    if (api.OpenProcessToken(handle, TOKEN_QUERY, token) === 0) return undefined
    const tokenHandle = token[0]
    try {
      const needed = [0]
      api.GetTokenInformation(tokenHandle, TokenIntegrityLevel, null, 0, needed)
      const size = needed[0] ?? 0
      if (size < 8) return undefined
      const info = Buffer.alloc(size)
      if (api.GetTokenInformation(tokenHandle, TokenIntegrityLevel, info, size, needed) === 0) return undefined
      const sid = info.readBigUInt64LE(0)
      const countPtr = api.GetSidSubAuthorityCount(sid)
      const count = koffi.decode(countPtr, 'uint8') as number
      if (count < 1) return undefined
      const ridPtr = api.GetSidSubAuthority(sid, count - 1)
      return koffi.decode(ridPtr, 'uint32') as number
    } finally {
      api.CloseHandle(tokenHandle)
    }
  } finally {
    api.CloseHandle(handle)
  }
}

function explorerFolder(hwnd: number): string | undefined {
  const script = `
$shell = New-Object -ComObject Shell.Application
foreach ($window in @($shell.Windows())) {
  if ([int64]$window.HWND -eq ${String(hwnd)}) {
    $window.Document.Folder.Self.Path
    break
  }
}
`
  try {
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    })
    const path = stdout.trim()
    return path === '' ? undefined : path
  } catch {
    return undefined
  }
}

function sendMouse(api: Bindings, flags: number, x: number, y: number, data = 0): void {
  const absolute = (flags & MOUSEEVENTF_ABSOLUTE) !== 0
  const left = api.GetSystemMetrics(SM_XVIRTUALSCREEN)
  const top = api.GetSystemMetrics(SM_YVIRTUALSCREEN)
  const width = Math.max(1, api.GetSystemMetrics(SM_CXVIRTUALSCREEN))
  const height = Math.max(1, api.GetSystemMetrics(SM_CYVIRTUALSCREEN))
  const input = {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: absolute ? Math.round(((x - left) * 65535) / Math.max(1, width - 1)) : x,
        dy: absolute ? Math.round(((y - top) * 65535) / Math.max(1, height - 1)) : y,
        mouseData: data,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  }
  if (api.SendInput(1, [input], INPUT.size) !== 1) {
    throw new Error('computer-use: pointer input failed')
  }
}

function withClipboard(api: Bindings, write: () => void): void {
  if (api.OpenClipboard(null) === 0) throw new Error('computer-use: OpenClipboard failed')
  try {
    write()
  } finally {
    api.CloseClipboard()
  }
}

/**
 * Win32 operations for the production Windows backend.
 * @returns operations that capture and post input on this machine.
 */
export function createProductionWindowsOps(): WindowsDesktopOps {
  if (process.arch === 'x64' && INPUT.size !== 40) {
    throw new Error(`computer-use: INPUT size ${String(INPUT.size)} is not 40`)
  }
  const libraries: NativeBindings = {
    user32: koffi.load('user32.dll'),
    gdi32: koffi.load('gdi32.dll'),
    kernel32: koffi.load('kernel32.dll'),
    shell32: koffi.load('shell32.dll'),
    advapi32: koffi.load('advapi32.dll'),
  }
  const api = bind(libraries)
  const selfRid = integrityRid(api, process.pid)

  function foreground(): WindowsForeground | undefined {
    const hwnd = api.GetForegroundWindow()
    if (isNull(hwnd)) return undefined
    const rect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 }
    if (api.GetWindowRect(hwnd, rect) === 0) return undefined
    const bounds: WindowsRect = {
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    }
    if (bounds.width <= 0 || bounds.height <= 0) return undefined
    const pid = pidOf(api, hwnd)
    const appName = processBaseName(api, pid) ?? 'unknown'
    const dpi = api.GetDpiForWindow(hwnd)
    const id = hwndId(hwnd)
    const folder = appName.toLowerCase() === 'explorer' && id !== undefined ? explorerFolder(id) : undefined
    return {
      appName,
      windowTitle: windowText(api, hwnd),
      bounds,
      scale: dpi > 0 ? dpi / 96 : 1,
      ...folder === undefined ? {} : { explorerFolder: folder },
    }
  }

  return {
    foreground,
    capturePng(bounds) {
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      const screenDc = api.GetDC(null)
      if (isNull(screenDc)) throw new Error('computer-use: screen capture failed')
      const memory = api.CreateCompatibleDC(screenDc)
      const bitmap = api.CreateCompatibleBitmap(screenDc, width, height)
      const previous = api.SelectObject(memory, bitmap)
      try {
        if (api.BitBlt(memory, 0, 0, width, height, screenDc, Math.round(bounds.x), Math.round(bounds.y), SRCCOPY) === 0) {
          throw new Error('computer-use: screen capture failed')
        }
        const header = {
          biSize: 40,
          biWidth: width,
          biHeight: height,
          biPlanes: 1,
          biBitCount: 32,
          biCompression: 0,
          biSizeImage: width * height * 4,
          biXPelsPerMeter: 0,
          biYPelsPerMeter: 0,
          biClrUsed: 0,
          biClrImportant: 0,
        }
        const pixels = Buffer.alloc(width * height * 4)
        if (api.GetDIBits(memory, bitmap, 0, height, pixels, header, 0) === 0) {
          throw new Error('computer-use: screen capture failed')
        }
        return encodeBgraPng(width, height, pixels, true)
      } finally {
        api.SelectObject(memory, previous)
        api.DeleteObject(bitmap)
        api.DeleteDC(memory)
        api.ReleaseDC(null, screenDc)
      }
    },
    targetBlocksInput() {
      const hwnd = api.GetForegroundWindow()
      if (isNull(hwnd) || selfRid === undefined) return false
      const rid = integrityRid(api, pidOf(api, hwnd))
      return rid !== undefined && rid > selfRid
    },
    movePointer(x, y) {
      sendMouse(api, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, x, y)
    },
    mouseButton(button, down) {
      const flags = button === 'right'
        ? (down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
        : (down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP)
      sendMouse(api, flags, 0, 0)
    },
    scrollWheel(x, y, delta) {
      sendMouse(api, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, x, y)
      sendMouse(api, MOUSEEVENTF_WHEEL, 0, 0, delta)
    },
    key(virtualKey, down) {
      const input = {
        type: INPUT_KEYBOARD,
        u: {
          ki: {
            wVk: virtualKey,
            wScan: 0,
            dwFlags: down ? 0 : KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
          },
        },
      }
      if (api.SendInput(1, [input], INPUT.size) !== 1) {
        throw new Error('computer-use: keyboard input failed')
      }
    },
    readClipboardText() {
      let text = ''
      withClipboard(api, () => {
        const handle = api.GetClipboardData(CF_UNICODETEXT)
        if (isNull(handle)) return
        const locked = api.GlobalLock(handle)
        if (isNull(locked)) return
        try {
          const size = Number(api.GlobalSize(handle))
          if (!Number.isFinite(size) || size < 2) return
          const bytes = Buffer.alloc(size)
          api.RtlMoveMemory(bytes, locked as Buffer, size)
          text = bytes.toString('utf16le').replace(/\0[\s\S]*$/u, '')
        } finally {
          api.GlobalUnlock(handle)
        }
      })
      return text
    },
    setClipboardText(text) {
      const bytes = Buffer.from(`${text}\0`, 'utf16le')
      const memory = api.GlobalAlloc(GMEM_MOVEABLE, bytes.length)
      if (isNull(memory)) throw new Error('computer-use: clipboard allocation failed')
      const locked = api.GlobalLock(memory)
      if (isNull(locked)) throw new Error('computer-use: clipboard allocation failed')
      api.RtlMoveMemory(locked, bytes, bytes.length)
      api.GlobalUnlock(memory)
      withClipboard(api, () => {
        api.EmptyClipboard()
        if (isNull(api.SetClipboardData(CF_UNICODETEXT, memory))) {
          throw new Error('computer-use: SetClipboardData failed')
        }
      })
    },
    copyImageFile(path) {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile(${JSON.stringify(path)})
try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
`
      execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
        windowsHide: true,
        timeout: 5000,
      })
    },
    listWindowApps() {
      const names = new Set<string>()
      const callback = koffi.register((hwnd: unknown) => {
        if (api.IsWindowVisible(hwnd) === 0) return 1
        const name = processBaseName(api, pidOf(api, hwnd))
        if (name !== undefined && name !== '') names.add(name)
        return 1
      }, koffi.pointer(api.enumProc))
      try {
        api.EnumWindows(callback, 0)
      } finally {
        koffi.unregister(callback)
      }
      return [...names]
    },
    activateApp(name) {
      const wanted = name.trim().toLowerCase()
      if (wanted === '') return false
      let found = false
      const callback = koffi.register((hwnd: unknown) => {
        if (found || api.IsWindowVisible(hwnd) === 0) return 1
        const app = (processBaseName(api, pidOf(api, hwnd)) ?? '').toLowerCase()
        const title = windowText(api, hwnd).toLowerCase()
        if (app === wanted || title.includes(wanted)) {
          libraries.user32.func('int __stdcall SetForegroundWindow(void *hWnd)')(hwnd)
          found = true
        }
        return 1
      }, koffi.pointer(api.enumProc))
      try {
        api.EnumWindows(callback, 0)
      } finally {
        koffi.unregister(callback)
      }
      return found
    },
    launch(target, parameters) {
      const result = Number(api.ShellExecuteW(null, 'open', target, parameters ?? null, null, SW_SHOWNORMAL))
      if (!Number.isFinite(result) || result <= 32) {
        throw new Error(`computer-use: failed to open ${target}`)
      }
    },
  }
}
