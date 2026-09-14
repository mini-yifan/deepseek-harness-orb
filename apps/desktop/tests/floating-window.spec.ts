import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  dockedOrigin,
  floatingContextMenuTemplate,
  FLOATING_BALL_SIZE,
  FLOATING_PANEL_SIZE,
} from '../src/floating-window.ts'

const workArea = { x: 100, y: 50, width: 1000, height: 800 }
const messages = { floatingOpenMain: 'Open Main Window', floatingQuit: 'Quit DeepSeek Harness' }

describe('floating window docking', () => {
  it('snaps the collapsed ball to the nearest work-area edge', () => {
    expect(dockedOrigin(
      { x: 120, y: 300, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE },
      workArea,
    )).toEqual({ x: 100, y: 300 })
    expect(dockedOrigin(
      { x: 980, y: 300, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE },
      workArea,
    )).toEqual({ x: 1028, y: 300 })
    expect(dockedOrigin(
      { x: 400, y: 60, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE },
      workArea,
    )).toEqual({ x: 400, y: 50 })
    expect(dockedOrigin(
      { x: 400, y: 780, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE },
      workArea,
    )).toEqual({ x: 400, y: 778 })
  })

  it('keeps an expanded panel inside the work area', () => {
    expect(dockedOrigin(
      { x: 90, y: 40, width: FLOATING_PANEL_SIZE.width, height: FLOATING_PANEL_SIZE.height },
      workArea,
    )).toEqual({ x: 100, y: 50 })
  })
})

describe('floating window context menu', () => {
  const onOpenMain = vi.fn()
  const onQuit = vi.fn()

  it('adds cut, copy, and paste when the target is editable', () => {
    const template = floatingContextMenuTemplate(
      { isEditable: true, editFlags: { canCut: false, canCopy: true, canPaste: true } },
      messages,
      onOpenMain,
      onQuit,
    )
    expect(template).toEqual([
      { role: 'cut', enabled: false },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { type: 'separator' },
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Quit DeepSeek Harness', click: onQuit },
    ])
  })

  it('keeps Open Main and Quit when the target is not editable', () => {
    const template = floatingContextMenuTemplate(
      { isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false } },
      messages,
      onOpenMain,
      onQuit,
    )
    expect(template).toEqual([
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Quit DeepSeek Harness', click: onQuit },
    ])
  })
})
