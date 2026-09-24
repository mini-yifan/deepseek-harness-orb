import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  clearOverlayGuardTransport,
  completeObservationFrameAck,
  completeOverlayGuardAck,
  completeSckCaptureAck,
  createComputerUseOverlayGuard,
  setOverlayGuardTransport,
  type ComputerUseOverlayGuard,
  type OverlayGuardIpcEvent,
  type OverlayGuardTransportEvent,
} from '../src/computer-use-overlay-guard.ts'

afterEach(() => {
  clearOverlayGuardTransport(new Error('dsh desktop: overlay-guard test reset'))
})

function overlayEvents(events: readonly OverlayGuardTransportEvent[]): OverlayGuardIpcEvent[] {
  return events.filter((event): event is OverlayGuardIpcEvent => event.type === 'overlay-guard')
}

function ack(event: OverlayGuardTransportEvent, excludeWindowIds: readonly number[] = []): void {
  if (event.type === 'observation-frame') completeObservationFrameAck(event.requestId)
  else if (event.type === 'sck-capture') completeSckCaptureAck(event.requestId)
  else completeOverlayGuardAck(event.requestId, excludeWindowIds)
}

describe('computer-use overlay guard', () => {
  it('passes through when no sender is installed', async () => {
    const ctx = new Context()
    apply(ctx)
    const guard = ctx.get('computerUseOverlayGuard') as ComputerUseOverlayGuard
    await expect(guard.withCapture(async (session) => {
      expect(session.excludeWindowIds).toEqual([])
      return 'shot'
    })).resolves.toBe('shot')
    await expect(guard.withInput(async () => 'click')).resolves.toBe('click')
    await expect(guard.setObservationFrame(null)).resolves.toBeUndefined()
    await expect(guard.captureExcludedRegion!({
      region: '0,0,10,10',
      excludeWindowIds: [1],
      output: '/tmp/screen.jpg',
    })).rejects.toThrow(/not attached/u)
  })

  it('passes through createComputerUseOverlayGuard without a sender', async () => {
    const guard = createComputerUseOverlayGuard()
    await expect(guard.withCapture(async () => 1)).resolves.toBe(1)
    await expect(guard.setObservationFrame({ x: 1, y: 2, width: 3, height: 4 })).resolves.toBeUndefined()
    expect(guard.captureExcludedRegion).toBeUndefined()
  })

  it('sends begin then end and waits for each ack', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event, event.type === 'overlay-guard' && event.mode === 'capture' ? [9] : []) })
    })
    const order: string[] = []
    await expect(guard.withCapture(async (session) => {
      order.push('run')
      expect(session.excludeWindowIds).toEqual([9])
      return 'ok'
    })).resolves.toBe('ok')
    expect(order).toEqual(['run'])
    expect(overlayEvents(events).map(event => `${event.action}:${event.mode}`)).toEqual(['begin:capture', 'end:capture'])
  })

  it('still sends end when the guarded call throws', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    await expect(guard.withInput(async () => {
      throw new Error('hid failed')
    })).rejects.toThrow('hid failed')
    expect(overlayEvents(events).map(event => event.action)).toEqual(['begin', 'end'])
    expect(overlayEvents(events)[0]?.mode).toBe('input')
  })

  it('times out when Electron never acks', { timeout: 3_000 }, async () => {
    const guard = createComputerUseOverlayGuard(() => undefined)
    await expect(guard.withCapture(async () => 'unused')).rejects.toThrow(/overlay-guard ack timed out/u)
  })

  it('still sends end when the begin ack is aborted', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      if (event.type === 'overlay-guard' && event.action === 'end') {
        queueMicrotask(() => { completeOverlayGuardAck(event.requestId) })
      }
    })
    const controller = new AbortController()
    const pending = guard.withCapture(async () => 'unused', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
    expect(overlayEvents(events).map(event => event.action)).toEqual(['begin', 'end'])
  })

  it('does not send input end until HID events have drained', async () => {
    const events: OverlayGuardTransportEvent[] = []
    let inRun = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    const pending = guard.withInput(async () => {
      inRun = true
      await gate
    })
    await expect.poll(() => inRun).toBe(true)
    expect(overlayEvents(events).map(event => event.action)).toEqual(['begin'])
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(overlayEvents(events).map(event => event.action)).toEqual(['begin'])
    await expect.poll(() => overlayEvents(events).map(event => event.action)).toEqual(['begin', 'end'])
    await pending
  })

  it('refreshes excludeWindowIds on nested withCapture inside withInput', async () => {
    const events: OverlayGuardTransportEvent[] = []
    let captureAcks = 0
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => {
        if (event.type === 'observation-frame') {
          completeObservationFrameAck(event.requestId)
          return
        }
        if (event.mode === 'input') {
          completeOverlayGuardAck(event.requestId, [4])
          return
        }
        captureAcks += 1
        completeOverlayGuardAck(event.requestId, captureAcks === 1 ? [4] : [4, 88])
      })
    })
    const seen: number[][] = []
    await guard.withInput(async () => {
      await guard.withInput(async () => undefined)
      await guard.withCapture(async (session) => {
        seen.push([...session.excludeWindowIds])
      })
      await guard.withCapture(async (session) => {
        seen.push([...session.excludeWindowIds])
        await guard.withCapture(async (inner) => {
          seen.push([...inner.excludeWindowIds])
        })
      })
    })
    expect(overlayEvents(events).map(event => `${event.action}:${event.mode}`)).toEqual([
      'begin:input',
      'begin:capture', 'end:capture',
      'begin:capture', 'end:capture',
      'end:input',
    ])
    expect(seen).toEqual([[4], [4, 88], [4, 88]])
  })

  it('nests withCapture without extra begin/end', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event, [9]) })
    })
    await guard.withCapture(async (outer) => {
      expect(outer.excludeWindowIds).toEqual([9])
      await guard.withCapture(async (inner) => {
        expect(inner.excludeWindowIds).toEqual([9])
      })
    })
    expect(overlayEvents(events).map(event => `${event.action}:${event.mode}`)).toEqual(['begin:capture', 'end:capture'])
  })

  it('sends observation-frame and waits for ack', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    const bounds = { x: 10, y: 20, width: 300, height: 200 }
    await guard.setObservationFrame(bounds)
    await guard.setObservationFrame(null)
    expect(events.filter(event => event.type === 'observation-frame')).toEqual([
      { type: 'observation-frame', requestId: expect.any(Number), bounds },
      { type: 'observation-frame', requestId: expect.any(Number), bounds: null },
    ])
  })

  it('times out when Electron never acks observation-frame', { timeout: 3_000 }, async () => {
    const guard = createComputerUseOverlayGuard(() => undefined)
    await expect(guard.setObservationFrame(null)).rejects.toThrow(/observation-frame ack timed out/u)
  })

  it('rejects observation-frame when the ack wait is aborted', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
    })
    const controller = new AbortController()
    const pending = guard.setObservationFrame(null, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
    expect(events.filter(event => event.type === 'observation-frame')).toEqual([
      { type: 'observation-frame', requestId: expect.any(Number), bounds: null },
    ])
  })

  it('sends hide when SHOW is requested with an already-aborted signal', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    const bounds = { x: 10, y: 20, width: 300, height: 200 }
    const controller = new AbortController()
    controller.abort()
    await expect(guard.setObservationFrame(bounds, controller.signal)).rejects.toThrow(/aborted/u)
    expect(events.filter(event => event.type === 'observation-frame')).toEqual([
      { type: 'observation-frame', requestId: expect.any(Number), bounds: null },
    ])
  })

  it('hides the observation frame when a SHOW ack wait is aborted', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      if (event.type === 'observation-frame' && event.bounds === null) {
        queueMicrotask(() => { completeObservationFrameAck(event.requestId) })
      }
    })
    const bounds = { x: 10, y: 20, width: 300, height: 200 }
    const controller = new AbortController()
    const pending = guard.setObservationFrame(bounds, controller.signal)
    expect(events.filter(event => event.type === 'observation-frame').map(event => event.bounds)).toEqual([bounds])
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
    expect(events.filter(event => event.type === 'observation-frame').map(event => event.bounds)).toEqual([bounds, null])
  })

  it('hides the observation frame when the turn aborts after SHOW ack', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    const bounds = { x: 10, y: 20, width: 300, height: 200 }
    const controller = new AbortController()
    await guard.setObservationFrame(bounds, controller.signal)
    controller.abort()
    await expect.poll(() =>
      events.filter(event => event.type === 'observation-frame').map(event => event.bounds),
    ).toEqual([bounds, null])
  })

  it('uses the installed transport from apply', async () => {
    const events: OverlayGuardTransportEvent[] = []
    setOverlayGuardTransport((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    const ctx = new Context()
    apply(ctx)
    const guard = ctx.get('computerUseOverlayGuard') as ComputerUseOverlayGuard
    await guard.withInput(async () => undefined)
    await guard.setObservationFrame(null)
    expect(overlayEvents(events).map(event => `${event.action}:${event.mode}`)).toEqual(['begin:input', 'end:input'])
    expect(events.some(event => event.type === 'observation-frame' && event.bounds === null)).toBe(true)
  })

  it('sends sck-capture and waits for ack', async () => {
    const events: OverlayGuardTransportEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { ack(event) })
    })
    await guard.captureExcludedRegion!({
      region: '0,0,10,10',
      excludeWindowIds: [9],
      output: '/tmp/screen.jpg',
    })
    expect(events.filter(event => event.type === 'sck-capture')).toEqual([
      {
        type: 'sck-capture',
        requestId: expect.any(Number),
        region: '0,0,10,10',
        excludeWindowIds: [9],
        output: '/tmp/screen.jpg',
      },
    ])
  })

  it('rejects sck-capture when Electron reports a failure', async () => {
    const guard = createComputerUseOverlayGuard((event) => {
      if (event.type === 'sck-capture') {
        queueMicrotask(() => { completeSckCaptureAck(event.requestId, 'TCC denied') })
      }
    })
    await expect(guard.captureExcludedRegion!({
      region: '0,0,10,10',
      excludeWindowIds: [1],
      output: '/tmp/screen.jpg',
    })).rejects.toThrow('TCC denied')
  })

  it('times out when Electron never acks sck-capture', async () => {
    vi.useFakeTimers()
    try {
      const guard = createComputerUseOverlayGuard(() => undefined)
      const pending = guard.captureExcludedRegion!({
        region: '0,0,10,10',
        excludeWindowIds: [1],
        output: '/tmp/screen.jpg',
      })
      const expectation = expect(pending).rejects.toThrow(/sck-capture ack timed out/u)
      await vi.advanceTimersByTimeAsync(30_000)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects sck-capture when the ack wait is aborted', async () => {
    const guard = createComputerUseOverlayGuard(() => undefined)
    const controller = new AbortController()
    const pending = guard.captureExcludedRegion!({
      region: '0,0,10,10',
      excludeWindowIds: [1],
      output: '/tmp/screen.jpg',
    }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
  })
})
