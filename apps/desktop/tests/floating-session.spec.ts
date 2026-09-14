import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FLOATING_SESSION_FILE,
  hiddenSessionBroadcast,
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

  it('broadcasts the hidden id into an already-booted main window', () => {
    expect(hiddenSessionBroadcast('session-orb')).toBe(
      'globalThis.__DSH_HIDDEN_SESSION_IDS__=["session-orb"];globalThis.dispatchEvent(new Event(\'dsh-hidden-sessions-changed\'))',
    )
  })
})
