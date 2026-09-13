import { describe, expect, it } from 'vitest'
import { delay } from '../src/wait.ts'

describe('delay', () => {
  it('returns immediately for a non-positive duration after an abort check', async () => {
    await delay(0, new AbortController().signal)
    await delay(-5, new AbortController().signal)
  })

  it('rejects when the signal is already aborted', async () => {
    const abort = new AbortController()
    abort.abort(new Error('stopped'))
    await expect(delay(0, abort.signal)).rejects.toThrow('stopped')
    await expect(delay(20, abort.signal)).rejects.toThrow('stopped')
  })

  it('rejects when aborted while waiting', async () => {
    const abort = new AbortController()
    const pending = delay(5_000, abort.signal)
    abort.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('wraps a non-Error abort reason', async () => {
    const abort = new AbortController()
    abort.abort('stopped')
    await expect(delay(20, abort.signal)).rejects.toThrow('computer-use: wait aborted')
  })

  it('resolves after a short wait', async () => {
    await delay(1, new AbortController().signal)
  })
})
