import { describe, expect, it } from 'vitest'
import { LONG_WAIT_SECONDS, WAIT_SECONDS, requireLongWaitSeconds } from '../src/wait-args.ts'

describe('wait durations', () => {
  it('fixes wait at 1 second', () => {
    expect(WAIT_SECONDS).toBe(1)
  })

  it('accepts only 10, 30, 60, and 120 for long_wait', () => {
    expect(LONG_WAIT_SECONDS).toEqual([10, 30, 60, 120])
    expect(LONG_WAIT_SECONDS.map(seconds => requireLongWaitSeconds(seconds))).toEqual([10, 30, 60, 120])
    expect(() => requireLongWaitSeconds(undefined)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(1)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(5)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(9)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(20)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(25)).toThrow(/10, 30, 60, or 120/u)
    expect(() => requireLongWaitSeconds(10.5)).toThrow(/10, 30, 60, or 120/u)
  })
})
