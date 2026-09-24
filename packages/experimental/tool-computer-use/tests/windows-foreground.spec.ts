import { describe, expect, it } from 'vitest'
import {
  selectWindowsObservation,
  type WindowsDesktopSnapshot,
  type WindowsWindowFact,
} from '../src/windows-foreground.ts'

const primary = { x: 0, y: 0, width: 2560, height: 1600 }
const left = { x: -1920, y: 0, width: 1920, height: 1080 }
const top = { x: 0, y: -1200, width: 1920, height: 1200 }

function fact(overrides: Partial<WindowsWindowFact> = {}): WindowsWindowFact {
  return {
    hwnd: 1,
    pid: 10,
    ownerHwnd: 0,
    className: 'Notepad',
    appName: 'notepad',
    title: 'notes.txt',
    visible: true,
    iconic: false,
    cloaked: false,
    toolWindow: false,
    popup: false,
    frame: { x: 100, y: 80, width: 400, height: 300 },
    monitor: primary,
    monitorDpi: 192,
    ...overrides,
  }
}

function snapshot(
  windows: readonly WindowsWindowFact[],
  foregroundHwnd = windows[0]?.hwnd ?? 0,
): WindowsDesktopSnapshot {
  return { foregroundHwnd, windows }
}

describe('windows observation selection', () => {
  it('prefers the foreground window and scales from that monitor DPI', () => {
    const behind = fact({ hwnd: 2, appName: 'behind', title: 'behind' })
    const front = fact({ hwnd: 7, appName: 'code', title: '  main.ts  ', frame: { x: 10, y: 20, width: 100, height: 64 } })
    const selected = selectWindowsObservation(snapshot([behind, front], 7), [])
    expect(selected).toMatchObject({
      appName: 'code',
      windowTitle: 'main.ts',
      windowId: 7,
      scale: 2,
      bounds: front.frame,
      transientWindowIds: [],
      focused: true,
    })
  })

  it('falls through an ineligible foreground window to the first operable window', () => {
    const menu = fact({ hwnd: 3, className: '#32768', title: 'menu' })
    const notes = fact({ hwnd: 4, appName: 'notepad', title: 'a.txt', monitorDpi: 0 })
    const selected = selectWindowsObservation(snapshot([menu, notes], 3), [])
    expect(selected).toMatchObject({ windowId: 4, scale: 1, appName: 'notepad', focused: false })
  })

  it('keeps focus when the foreground window is the owner menu and drops it for an excluded overlay', () => {
    const owner = fact({ hwnd: 10, pid: 4, frame: { x: 0, y: 0, width: 400, height: 300 } })
    const menu = fact({
      hwnd: 11,
      pid: 99,
      className: '#32768',
      popup: true,
      frame: { x: 20, y: 20, width: 80, height: 40 },
    })
    const overlay = fact({ hwnd: 12, appName: 'electron', title: 'ball' })
    expect(selectWindowsObservation(snapshot([owner, menu], 11), [])).toMatchObject({
      windowId: 10,
      focused: true,
      transientWindowIds: [11],
    })
    expect(selectWindowsObservation(snapshot([overlay, owner], 12), [12])).toMatchObject({
      windowId: 10,
      focused: false,
      transientWindowIds: [],
    })
  })

  it('skips overlay hwnds, shell windows, and windows that cannot own an observation', () => {
    const cases: Array<{ window: WindowsWindowFact; exclude?: number[] }> = [
      { window: fact(), exclude: [1] },
      { window: fact({ visible: false }) },
      { window: fact({ iconic: true }) },
      { window: fact({ cloaked: true }) },
      { window: fact({ toolWindow: true }) },
      { window: fact({ className: 'Shell_TrayWnd' }) },
      { window: fact({ className: 'Shell_SecondaryTrayWnd' }) },
      { window: fact({ className: 'Progman' }) },
      { window: fact({ className: 'WorkerW' }) },
      { window: fact({ className: 'ComboLBox' }) },
      { window: fact({ frame: { x: 0, y: 0, width: 63, height: 80 } }) },
      { window: fact({ frame: { x: 0, y: 0, width: 80, height: 63 } }) },
    ]
    for (const entry of cases) {
      expect(selectWindowsObservation(snapshot([entry.window]), entry.exclude ?? [])).toBeUndefined()
    }
    expect(selectWindowsObservation(snapshot([]), [])).toBeUndefined()
    expect(selectWindowsObservation(snapshot([fact({ hwnd: 8 })]), [1.5, 0, -4])?.windowId).toBe(8)
  })

  it('unions same-monitor menus and owned popups, including a negative-origin screen', () => {
    const owner = fact({
      hwnd: 10,
      pid: 4,
      appName: 'explorer',
      title: 'work',
      frame: { x: -1800, y: 40, width: 900, height: 700 },
      monitor: left,
      monitorDpi: 96,
    })
    const menu = fact({
      hwnd: 11,
      pid: 99,
      className: '#32768',
      appName: 'explorer',
      title: '',
      popup: true,
      frame: { x: -1000, y: 80, width: 180, height: 220 },
      monitor: left,
      monitorDpi: 96,
    })
    const hop = fact({
      hwnd: 15,
      pid: 4,
      ownerHwnd: 10,
      className: 'Owned',
      appName: 'explorer',
      title: 'hop',
      frame: { x: -1700, y: 60, width: 80, height: 40 },
      monitor: left,
      monitorDpi: 96,
    })
    const owned = fact({
      hwnd: 12,
      pid: 4,
      ownerHwnd: 15,
      appName: 'explorer',
      title: 'dialog',
      frame: { x: -1900, y: 20, width: 200, height: 120 },
      monitor: left,
      monitorDpi: 96,
    })
    const otherScreen = fact({
      hwnd: 13,
      pid: 99,
      className: '#32768',
      popup: true,
      frame: { x: 40, y: 40, width: 200, height: 200 },
      monitor: primary,
      monitorDpi: 192,
    })
    const taskbar = fact({
      hwnd: 14,
      pid: 4,
      className: 'Shell_TrayWnd',
      appName: 'explorer',
      title: '',
      frame: { x: -1920, y: 1040, width: 1920, height: 40 },
      monitor: left,
      monitorDpi: 96,
    })
    const selected = selectWindowsObservation(snapshot([
      owner,
      menu,
      hop,
      owned,
      otherScreen,
      taskbar,
    ], 10), [])
    expect(selected).toMatchObject({
      appName: 'explorer',
      windowTitle: 'work',
      windowId: 10,
      scale: 1,
      transientWindowIds: [11, 15, 12],
      bounds: { x: -1900, y: 20, width: 1080, height: 720 },
    })
  })

  it('merges an intersecting same-process popup and a combo dropdown, and keeps interior popups inside the owner', () => {
    const owner = fact({ hwnd: 20, pid: 3, frame: { x: 0, y: 0, width: 100, height: 100 }, monitorDpi: 144 })
    const popup = fact({
      hwnd: 21,
      pid: 3,
      popup: true,
      title: 'list',
      frame: { x: 140, y: 10, width: 30, height: 40 },
    })
    const inside = fact({
      hwnd: 22,
      pid: 3,
      popup: true,
      frame: { x: 10, y: 10, width: 20, height: 20 },
    })
    const combo = fact({
      hwnd: 23,
      pid: 8,
      className: 'ComboLBox',
      popup: true,
      frame: { x: 90, y: 90, width: 40, height: 80 },
    })
    const selected = selectWindowsObservation(snapshot([owner, popup, inside, combo], 20), [99])
    expect(selected).toMatchObject({
      scale: 1.5,
      transientWindowIds: [21, 22, 23],
      bounds: { x: 0, y: 0, width: 170, height: 170 },
    })
  })

  it('does not merge popups or menus that miss the owner, other apps, or another monitor', () => {
    const owner = fact({ hwnd: 30, pid: 3, frame: { x: 0, y: 0, width: 100, height: 100 } })
    const missed = [
      fact({ hwnd: 31, pid: 3, popup: true, frame: { x: 149, y: 0, width: 10, height: 10 } }),
      fact({ hwnd: 32, pid: 3, popup: true, frame: { x: -200, y: 0, width: 10, height: 10 } }),
      fact({ hwnd: 33, pid: 3, popup: true, frame: { x: 0, y: 200, width: 10, height: 10 } }),
      fact({ hwnd: 34, pid: 3, popup: true, frame: { x: 0, y: -200, width: 10, height: 10 } }),
      fact({ hwnd: 35, pid: 3, popup: false, frame: { x: 10, y: 10, width: 80, height: 80 } }),
      fact({ hwnd: 36, pid: 9, className: 'Chrome', frame: { x: 10, y: 10, width: 80, height: 80 } }),
      fact({ hwnd: 37, pid: 9, className: '#32768', frame: { x: 400, y: 400, width: 80, height: 40 } }),
      fact({ hwnd: 38, pid: 3, ownerHwnd: 30, frame: { x: 0, y: -1100, width: 80, height: 80 }, monitor: top }),
      fact({ hwnd: 39, pid: 3, popup: true, visible: false, frame: { x: 10, y: 10, width: 80, height: 80 } }),
      fact({ hwnd: 40, pid: 3, popup: true, iconic: true, frame: { x: 10, y: 10, width: 80, height: 80 } }),
      fact({ hwnd: 41, pid: 3, popup: true, cloaked: true, frame: { x: 10, y: 10, width: 80, height: 80 } }),
      fact({ hwnd: 42, pid: 3, popup: true, frame: { x: 10, y: 10, width: 0, height: 80 } }),
      fact({ hwnd: 43, pid: 3, className: 'Shell_TrayWnd', popup: true, frame: { x: 0, y: 90, width: 100, height: 40 } }),
    ]
    const selected = selectWindowsObservation(snapshot([owner, ...missed], 30), [43])
    expect(selected?.transientWindowIds).toEqual([])
    expect(selected?.bounds).toEqual(owner.frame)
  })

  it('walks an owner chain and stops on a cycle or a missing owner', () => {
    const owner = fact({ hwnd: 50, pid: 5, frame: { x: 0, y: 0, width: 200, height: 200 } })
    const mid = fact({ hwnd: 51, pid: 5, ownerHwnd: 50, frame: { x: 210, y: 0, width: 40, height: 40 } })
    const leaf = fact({ hwnd: 52, pid: 5, ownerHwnd: 51, frame: { x: 260, y: 0, width: 40, height: 40 } })
    const cycled = fact({ hwnd: 53, pid: 5, ownerHwnd: 54, frame: { x: 10, y: 10, width: 40, height: 40 } })
    const cycle = fact({ hwnd: 54, pid: 5, ownerHwnd: 53, frame: { x: 20, y: 20, width: 40, height: 40 } })
    const missing = fact({ hwnd: 55, pid: 5, ownerHwnd: 999, frame: { x: 10, y: 10, width: 40, height: 40 } })
    const selected = selectWindowsObservation(snapshot([owner, mid, leaf, cycled, cycle, missing], 50), [])
    expect(selected?.transientWindowIds).toEqual([51, 52])
    expect(selected?.bounds).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('keeps each monitor separate when the foreground window is on a side screen', () => {
    const primaryApp = fact({
      hwnd: 60,
      pid: 1,
      appName: 'primary',
      frame: { x: 100, y: 100, width: 800, height: 600 },
      monitor: primary,
      monitorDpi: 192,
    })
    const side = fact({
      hwnd: 61,
      pid: 2,
      appName: 'side',
      title: 'side',
      frame: { x: -1500, y: 100, width: 700, height: 500 },
      monitor: left,
      monitorDpi: 96,
    })
    const sideMenu = fact({
      hwnd: 62,
      pid: 8,
      className: 'ComboLBox',
      popup: true,
      frame: { x: -900, y: 140, width: 120, height: 200 },
      monitor: left,
      monitorDpi: 96,
    })
    const upper = fact({
      hwnd: 63,
      pid: 2,
      popup: true,
      frame: { x: 40, y: -900, width: 200, height: 100 },
      monitor: top,
      monitorDpi: 144,
    })
    const selected = selectWindowsObservation(snapshot([primaryApp, side, sideMenu, upper], 61), [])
    expect(selected).toMatchObject({
      windowId: 61,
      scale: 1,
      transientWindowIds: [62],
      bounds: { x: -1500, y: 100, width: 720, height: 500 },
    })
  })

  it('rejects an owned window once any monitor edge differs', () => {
    const owner = fact({ hwnd: 70, pid: 6, frame: { x: 0, y: 0, width: 200, height: 200 }, monitor: primary })
    const edges = [
      { x: 1, y: 0, width: 2560, height: 1600 },
      { x: 0, y: 1, width: 2560, height: 1600 },
      { x: 0, y: 0, width: 2500, height: 1600 },
      { x: 0, y: 0, width: 2560, height: 1500 },
    ]
    for (const [index, monitor] of edges.entries()) {
      const child = fact({ hwnd: 80 + index, pid: 6, ownerHwnd: 70, monitor, frame: { x: 0, y: 0, width: 80, height: 80 } })
      const selected = selectWindowsObservation(snapshot([owner, child], 70), [])
      expect(selected?.transientWindowIds).toEqual([])
    }
  })
})
