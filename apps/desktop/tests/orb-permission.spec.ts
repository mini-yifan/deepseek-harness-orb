import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_ORB_PERMISSION,
  ORB_PERMISSION_FILE,
  isOrbPermissionPreset,
  readOrbPermission,
  writeOrbPermission,
} from '../src/orb-permission.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('orb permission persistence', () => {
  it('defaults to Full access when the file is missing or invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orb-permission-'))
    roots.push(root)
    expect(readOrbPermission(root)).toBe(DEFAULT_ORB_PERMISSION)
    expect(readOrbPermission(join(root, 'missing'))).toBe(DEFAULT_ORB_PERMISSION)
    writeFileSync(join(root, ORB_PERMISSION_FILE), '[]\n')
    expect(readOrbPermission(root)).toBe(DEFAULT_ORB_PERMISSION)
    writeFileSync(join(root, ORB_PERMISSION_FILE), '{broken')
    expect(readOrbPermission(root)).toBe(DEFAULT_ORB_PERMISSION)
    writeFileSync(join(root, ORB_PERMISSION_FILE), `${JSON.stringify({ preset: 'yolo' })}\n`)
    expect(readOrbPermission(root)).toBe(DEFAULT_ORB_PERMISSION)
  })

  it('round-trips a stored overlay Access preset', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orb-permission-write-'))
    roots.push(root)
    writeOrbPermission(root, 'workspace-write')
    expect(JSON.parse(readFileSync(join(root, ORB_PERMISSION_FILE), 'utf8'))).toEqual({
      preset: 'workspace-write',
    })
    expect(readOrbPermission(root)).toBe('workspace-write')
    writeOrbPermission(root, 'read-only')
    expect(readOrbPermission(root)).toBe('read-only')
  })

  it('accepts only the overlay Access ids', () => {
    expect(isOrbPermissionPreset('danger-full-access')).toBe(true)
    expect(isOrbPermissionPreset('workspace-write')).toBe(true)
    expect(isOrbPermissionPreset('read-only')).toBe(true)
    expect(isOrbPermissionPreset('custom')).toBe(false)
    expect(isOrbPermissionPreset(1)).toBe(false)
  })
})
