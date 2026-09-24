import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureOrbWorkspaceDir,
  FLOATING_SESSION_FILE,
  readFloatingSessionId,
  writeFloatingSessionId,
} from '../src/floating-session.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('floating session persistence', () => {
  it('reads and writes a non-empty session id', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-floating-session-'))
    roots.push(root)
    expect(readFloatingSessionId(root)).toBeUndefined()
    writeFloatingSessionId(root, 'session-orb')
    expect(JSON.parse(readFileSync(join(root, FLOATING_SESSION_FILE), 'utf8'))).toEqual({
      sessionId: 'session-orb',
    })
    expect(readFloatingSessionId(root)).toBe('session-orb')
  })

  it('ignores missing, invalid, and blank records', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-floating-session-bad-'))
    roots.push(root)
    expect(readFloatingSessionId(join(root, 'missing'))).toBeUndefined()
    writeFileSync(join(root, FLOATING_SESSION_FILE), '[]\n')
    expect(readFloatingSessionId(root)).toBeUndefined()
    writeFileSync(join(root, FLOATING_SESSION_FILE), '{"sessionId":""}\n')
    expect(readFloatingSessionId(root)).toBeUndefined()
    writeFileSync(join(root, FLOATING_SESSION_FILE), '{broken')
    expect(readFloatingSessionId(root)).toBeUndefined()
  })

  it('creates the dsh_orb directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-floating-orb-dir-'))
    roots.push(root)
    const path = join(root, 'dsh_orb')
    expect(ensureOrbWorkspaceDir(path)).toBe(path)
    expect(existsSync(path)).toBe(true)
    expect(ensureOrbWorkspaceDir(path)).toBe(path)
  })
})
