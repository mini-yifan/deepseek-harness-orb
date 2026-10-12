import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BALL_ENABLED_FILE, readBallEnabled, writeBallEnabled } from '../src/ball-enabled.ts'
import {
  OBSERVATION_FRAME_FILE,
  readObservationFrameEnabled,
  writeObservationFrameEnabled,
} from '../src/observation-frame-preference.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-orb-toggle-'))
  roots.push(root)
  return root
}

describe('orb toggles', () => {
  it('defaults both toggles to enabled for a missing or invalid file', () => {
    const root = profile()
    expect(readBallEnabled(root)).toBe(true)
    expect(readObservationFrameEnabled(root)).toBe(true)
    writeFileSync(join(root, BALL_ENABLED_FILE), 'not json')
    writeFileSync(join(root, OBSERVATION_FRAME_FILE), `${JSON.stringify({ enabled: 'yes' }, undefined, 2)}\n`)
    expect(readBallEnabled(root)).toBe(true)
    expect(readObservationFrameEnabled(root)).toBe(true)
  })

  it('round-trips a disabled ball and a hidden ribbon', () => {
    const root = profile()
    writeBallEnabled(root, false)
    writeObservationFrameEnabled(root, false)
    expect(readBallEnabled(root)).toBe(false)
    expect(readObservationFrameEnabled(root)).toBe(false)
    writeBallEnabled(root, true)
    writeObservationFrameEnabled(root, true)
    expect(readBallEnabled(root)).toBe(true)
    expect(readObservationFrameEnabled(root)).toBe(true)
  })
})
