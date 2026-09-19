import { describe, expect, it, vi } from 'vitest'
import { applyMillifractionCoordinates } from '../src/millifraction-coordinates-apply.ts'
import { en } from '../src/locale.ts'

const messages = {
  millifractionConfirmTitle: en.millifractionConfirmTitle,
  millifractionConfirmMessage: en.millifractionConfirmMessage,
  millifractionConfirmDetail: en.millifractionConfirmDetail,
  millifractionConfirmOk: en.millifractionConfirmOk,
  millifractionConfirmCancel: en.millifractionConfirmCancel,
}

describe('millifraction coordinates confirm apply', () => {
  it('cancels without writing, pushing, or creating', async () => {
    const persist = vi.fn()
    const pushHost = vi.fn()
    const createOverlaySession = vi.fn()
    const result = await applyMillifractionCoordinates({
      requestedEnabled: false,
      currentEnabled: true,
      messages,
      dialog: { show: async () => false },
      persist,
      pushHost,
      createOverlaySession,
    })
    expect(result).toEqual({ applied: false })
    expect(persist).not.toHaveBeenCalled()
    expect(pushHost).not.toHaveBeenCalled()
    expect(createOverlaySession).not.toHaveBeenCalled()
  })

  it('writes the inverted default, pushes Host, and creates an overlay session', async () => {
    const persist = vi.fn()
    const pushHost = vi.fn()
    const createOverlaySession = vi.fn()
    const result = await applyMillifractionCoordinates({
      requestedEnabled: false,
      currentEnabled: true,
      messages,
      dialog: {
        async show(options) {
          expect(options.title).toBe(en.millifractionConfirmTitle)
          expect(options.message).toBe(en.millifractionConfirmMessage)
          return true
        },
      },
      persist,
      pushHost,
      createOverlaySession,
    })
    expect(result).toEqual({ applied: true, enabled: false })
    expect(persist).toHaveBeenCalledWith(false)
    expect(pushHost).toHaveBeenCalledWith('pixel')
    expect(createOverlaySession).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the requested default already matches', async () => {
    const persist = vi.fn()
    const show = vi.fn(async () => true)
    const result = await applyMillifractionCoordinates({
      requestedEnabled: true,
      currentEnabled: true,
      messages,
      dialog: { show },
      persist,
      pushHost: vi.fn(),
      createOverlaySession: vi.fn(),
    })
    expect(result).toEqual({ applied: false })
    expect(show).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
