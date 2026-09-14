import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  clearOverlayGuardTransport,
  completeOverlayGuardAck,
  createComputerUseOverlayGuard,
  setOverlayGuardTransport,
  type ComputerUseOverlayGuard,
  type OverlayGuardIpcEvent,
} from '../src/computer-use-overlay-guard.ts'

afterEach(() => {
  clearOverlayGuardTransport(new Error('dsh desktop: overlay-guard test reset'))
})

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
  })

  it('passes through createComputerUseOverlayGuard without a sender', async () => {
    const guard = createComputerUseOverlayGuard()
    await expect(guard.withCapture(async () => 1)).resolves.toBe(1)
  })

  it('sends begin then end and waits for each ack', async () => {
    const events: OverlayGuardIpcEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { completeOverlayGuardAck(event.requestId, event.mode === 'capture' ? [9] : []) })
    })
    const order: string[] = []
    await expect(guard.withCapture(async (session) => {
      order.push('run')
      expect(session.excludeWindowIds).toEqual([9])
      return 'ok'
    })).resolves.toBe('ok')
    expect(order).toEqual(['run'])
    expect(events.map(event => `${event.action}:${event.mode}`)).toEqual(['begin:capture', 'end:capture'])
  })

  it('still sends end when the guarded call throws', async () => {
    const events: OverlayGuardIpcEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { completeOverlayGuardAck(event.requestId) })
    })
    await expect(guard.withInput(async () => {
      throw new Error('hid failed')
    })).rejects.toThrow('hid failed')
    expect(events.map(event => event.action)).toEqual(['begin', 'end'])
    expect(events[0]?.mode).toBe('input')
  })

  it('times out when Electron never acks', { timeout: 3_000 }, async () => {
    const guard = createComputerUseOverlayGuard(() => undefined)
    await expect(guard.withCapture(async () => 'unused')).rejects.toThrow(/overlay-guard ack timed out/u)
  })

  it('still sends end when the begin ack is aborted', async () => {
    const events: OverlayGuardIpcEvent[] = []
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      if (event.action === 'end') queueMicrotask(() => { completeOverlayGuardAck(event.requestId) })
    })
    const controller = new AbortController()
    const pending = guard.withCapture(async () => 'unused', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
    expect(events.map(event => event.action)).toEqual(['begin', 'end'])
  })

  it('does not send input end until HID events have drained', async () => {
    const events: OverlayGuardIpcEvent[] = []
    let inRun = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const guard = createComputerUseOverlayGuard((event) => {
      events.push(event)
      queueMicrotask(() => { completeOverlayGuardAck(event.requestId) })
    })
    const pending = guard.withInput(async () => {
      inRun = true
      await gate
    })
    await expect.poll(() => inRun).toBe(true)
    expect(events.map(event => event.action)).toEqual(['begin'])
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(events.map(event => event.action)).toEqual(['begin'])
    await expect.poll(() => events.map(event => event.action)).toEqual(['begin', 'end'])
    await pending
  })

  it('uses the installed transport from apply', async () => {
    const events: OverlayGuardIpcEvent[] = []
    setOverlayGuardTransport((event) => {
      events.push(event)
      queueMicrotask(() => { completeOverlayGuardAck(event.requestId) })
    })
    const ctx = new Context()
    apply(ctx)
    const guard = ctx.get('computerUseOverlayGuard') as ComputerUseOverlayGuard
    await guard.withInput(async () => undefined)
    expect(events.map(event => `${event.action}:${event.mode}`)).toEqual(['begin:input', 'end:input'])
  })
})
