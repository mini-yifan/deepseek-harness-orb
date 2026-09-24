import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MILLIFRACTION_COORDINATES_FILE,
  orbCoordinateModeFor,
  readMillifractionCoordinates,
  writeMillifractionCoordinates,
} from '../src/millifraction-coordinates.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('millifraction coordinates config', () => {
  it('defaults to millifraction enabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-millifraction-'))
    roots.push(root)
    expect(readMillifractionCoordinates(root)).toEqual({ enabled: true })
    expect(orbCoordinateModeFor(true)).toBe('millifraction')
    expect(orbCoordinateModeFor(false)).toBe('pixel')
  })

  it('reads and writes enablement beside other orb prefs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-millifraction-rw-'))
    roots.push(root)
    writeFileSync(join(root, 'floating-session.json'), '{"sessionId":"keep"}\n')
    writeMillifractionCoordinates(root, { enabled: false })
    expect(JSON.parse(readFileSync(join(root, MILLIFRACTION_COORDINATES_FILE), 'utf8'))).toEqual({
      enabled: false,
    })
    expect(readMillifractionCoordinates(root)).toEqual({ enabled: false })
    expect(readFileSync(join(root, 'floating-session.json'), 'utf8')).toBe('{"sessionId":"keep"}\n')
  })

  it('ignores invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-millifraction-bad-'))
    roots.push(root)
    writeFileSync(join(root, MILLIFRACTION_COORDINATES_FILE), '[]\n')
    expect(readMillifractionCoordinates(root).enabled).toBe(true)
    writeFileSync(join(root, MILLIFRACTION_COORDINATES_FILE), '{"enabled":"no"}\n')
    expect(readMillifractionCoordinates(root).enabled).toBe(true)
  })
})
