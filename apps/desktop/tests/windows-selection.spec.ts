import { describe, expect, it, vi } from 'vitest'
import { dispatchWindowsSelectionMessage, startWindowsSelectionMonitor } from '../src/windows-selection.ts'
import type { SelectionHelperEvent } from '../src/selection-monitor.ts'

describe('windows selection monitor', () => {
  it('emits a selection after left mouse-up and ignores excluded pids', async () => {
    const events: SelectionHelperEvent[] = []
    const readSelection = vi.fn(async () => ({ text: 'hello', pid: 7, x: 1, y: 2, width: 3, height: 4 }))
    dispatchWindowsSelectionMessage(
      { type: 'mouse-up', x: 10, y: 20, button: 'left' },
      { onEvent: (event) => { events.push(event) } },
      { readSelection, activatePid: () => undefined },
      new Set(),
    )
    await vi.waitFor(() => { expect(events.map(event => event.type)).toEqual(['mouse-up', 'selection']) })
    expect(events[1]).toMatchObject({
      type: 'selection',
      text: 'hello',
      pid: 7,
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    })
  })

  it('drops a selection owned by an excluded pid', async () => {
    const events: SelectionHelperEvent[] = []
    let finish: (value: { text: string; pid: number }) => void = () => undefined
    const readSelection = vi.fn(() => new Promise<{ text: string; pid: number }>((resolve) => { finish = resolve }))
    dispatchWindowsSelectionMessage(
      { type: 'mouse-up', x: 10, y: 20, button: 'left' },
      { onEvent: (event) => { events.push(event) } },
      { readSelection, activatePid: () => undefined },
      new Set([7]),
    )
    expect(events).toEqual([{ type: 'mouse-up', x: 10, y: 20 }])
    finish({ text: 'hello', pid: 7 })
    await vi.waitFor(() => { expect(readSelection).toHaveBeenCalled() })
    await Promise.resolve()
    expect(events).toEqual([{ type: 'mouse-up', x: 10, y: 20 }])
  })

  it('dismisses right-clicks and reports ready without installing a failed hook', () => {
    const events: SelectionHelperEvent[] = []
    dispatchWindowsSelectionMessage(
      { type: 'mouse-down', x: 1, y: 2, button: 'right' },
      { onEvent: (event) => { events.push(event) } },
      { readSelection: async () => undefined, activatePid: () => undefined },
      new Set(),
    )
    expect(events).toEqual([{ type: 'dismiss' }])
    const monitor = startWindowsSelectionMonitor(
      { onEvent: (event) => { events.push(event) } },
      { readSelection: async () => undefined, activatePid: () => undefined },
      () => { throw new Error('hook unavailable') },
    )
    expect(events.at(-1)).toEqual({ type: 'ready' })
    monitor.stop()
  })
})
