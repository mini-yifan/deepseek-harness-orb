import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { SELECTION_DEDUPE_MS, SelectionToolbarController } from '../src/selection-toolbar-controller.ts'
import { DESKTOP_SELECTION_PREAMBLE } from '../src/selection-prompt.ts'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
}))

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fakeToolbar() {
  const bounds = { x: 10, y: 20, width: 280, height: 46 }
  const window = {
    destroyed: false,
    visible: false,
    bounds,
    webContents: { send: vi.fn() },
    isDestroyed() { return window.destroyed },
    isVisible() { return window.visible },
    getBounds() { return window.bounds },
    setBounds: vi.fn((next: typeof bounds) => {
      bounds.x = next.x
      bounds.y = next.y
      bounds.width = next.width
      bounds.height = next.height
    }),
    showInactive: vi.fn(() => { window.visible = true }),
    hide: vi.fn(() => { window.visible = false }),
    once: vi.fn(),
  }
  return window
}

describe('selection toolbar controller', () => {
  it('opens Bing, prompts translate/explain, and skips reads while running or during HID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-selection-controller-'))
    roots.push(root)
    const openExternal = vi.fn(async () => undefined)
    const promptOverlay = vi.fn()
    const requestAccessibility = vi.fn(() => false)
    const exclude: number[][] = []
    let now = 1_000
    const controller = new SelectionToolbarController(root, {
      electronPid: 99,
      openExternal,
      promptOverlay,
      requestAccessibility,
      now: () => now,
      startMonitor: () => ({
        stop: vi.fn(),
        setExcludePids: (pids: readonly number[]) => { exclude.push([...pids]) },
      }),
    })
    const toolbar = fakeToolbar()
    controller.setToolbarWindow(toolbar as never)
    controller.start()
    expect(exclude).toEqual([[99]])
    controller.onHelperEvent({
      type: 'selection',
      text: 'hello',
      pid: 7,
      bundle: 'com.app',
      x: 40,
      y: 50,
    })
    expect(toolbar.showInactive).toHaveBeenCalled()
    await controller.search()
    expect(openExternal).toHaveBeenCalledWith('https://www.bing.com/search?q=hello')
    controller.onHelperEvent({
      type: 'selection',
      text: 'hello',
      pid: 7,
      bundle: 'com.app',
      x: 40,
      y: 50,
    })
    controller.translate()
    expect(promptOverlay).toHaveBeenCalledWith(
      `${DESKTOP_SELECTION_PREAMBLE}\n\nTranslate the following into Chinese:\n\nhello`,
    )
    controller.setLanguage('en')
    expect(toolbar.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.selectionState, { language: 'en' })
    controller.explain()
    expect(promptOverlay).toHaveBeenCalledWith(
      `${DESKTOP_SELECTION_PREAMBLE}\n\nExplain this text:\n\nhello`,
    )
    toolbar.showInactive.mockClear()
    controller.setSessionRunning(true)
    expect(toolbar.hide).toHaveBeenCalled()
    controller.onHelperEvent({ type: 'selection', text: 'later', pid: 8 })
    expect(toolbar.showInactive).not.toHaveBeenCalled()
    controller.setSessionRunning(false)
    controller.setHidInput(true)
    controller.onHelperEvent({ type: 'selection', text: 'hid', pid: 9 })
    expect(toolbar.showInactive).not.toHaveBeenCalled()
    controller.setHidInput(false)
    now += SELECTION_DEDUPE_MS + 1
    controller.onHelperEvent({ type: 'untrusted' })
    expect(requestAccessibility).toHaveBeenCalledTimes(1)
    controller.onHelperEvent({ type: 'untrusted' })
    expect(requestAccessibility).toHaveBeenCalledTimes(1)
    controller.toggle()
    expect(controller.enabled()).toBe(false)
  })

  it('grows the toolbar for the language menu and flips it above the bar near the work-area edge', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-selection-menu-'))
    roots.push(root)
    const controller = new SelectionToolbarController(root, {
      electronPid: 99,
      openExternal: async () => undefined,
      promptOverlay: vi.fn(),
      requestAccessibility: () => false,
      startMonitor: () => ({ stop: vi.fn(), setExcludePids: vi.fn() }),
    })
    const toolbar = fakeToolbar()
    controller.setToolbarWindow(toolbar as never)
    controller.onHelperEvent({
      type: 'selection',
      text: 'hello',
      x: 40,
      y: 50,
    })
    expect(controller.setContentSize(280, 120)).toEqual({ menuAbove: false })
    expect(toolbar.setBounds).toHaveBeenCalledWith(expect.objectContaining({ y: 58, height: 120 }))
    controller.onHelperEvent({
      type: 'selection',
      text: 'edge',
      pid: 2,
      bounds: { x: 10, y: 800, width: 40, height: 20 },
    })
    expect(controller.setContentSize(280, 120)).toEqual({ menuAbove: true })
    expect(toolbar.bounds.y).toBeLessThan(828)
    expect(toolbar.bounds.height).toBe(120)
  })
})
