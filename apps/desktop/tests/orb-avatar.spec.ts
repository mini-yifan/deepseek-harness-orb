import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOrbSettingsWritable,
  DEFAULT_ORB_AVATAR_FILE,
  installOrbAvatarFromPath,
  interpretOrbAvatarBytes,
  MAX_ORB_AVATAR_BYTES,
  ORB_AVATAR_BYTES_FILE,
  ORB_AVATAR_META_FILE,
  ORB_SETTINGS_MACOS_ONLY,
  orbAvatarCacheToken,
  orbAvatarUrl,
  orbSettingsSupported,
  restoreOrbAvatar,
  serveOrbAvatar,
} from '../src/orb-avatar.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const GIF89A = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x3b,
])
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x00,
])

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-orb-avatar-'))
  roots.push(root)
  return root
}

function writeImage(root: string, name: string, bytes: Uint8Array): string {
  const path = join(root, name)
  writeFileSync(path, bytes)
  return path
}

describe('orb avatar persistence', () => {
  it('accepts GIF, PNG, and WebP magic that matches the extension', () => {
    expect(interpretOrbAvatarBytes(GIF89A, 'ball.gif')).toBe('image/gif')
    expect(interpretOrbAvatarBytes(PNG, 'ball.png')).toBe('image/png')
    expect(interpretOrbAvatarBytes(WEBP, 'ball.webp')).toBe('image/webp')
    expect(interpretOrbAvatarBytes(GIF89A, 'ball.png')).toBeUndefined()
    expect(interpretOrbAvatarBytes(new Uint8Array([0x00, 0x01]), 'ball.gif')).toBeUndefined()
  })

  it('installs a GIF under the cap and restores the packaged default', async () => {
    const root = profile()
    const gif = writeImage(root, 'picked.gif', GIF89A)
    expect(installOrbAvatarFromPath(root, gif)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(join(root, ORB_AVATAR_META_FILE), 'utf8'))).toEqual({ mime: 'image/gif' })
    expect(orbAvatarCacheToken(root)).toBe(statSync(join(root, ORB_AVATAR_BYTES_FILE)).mtimeMs)
    const served = await serveOrbAvatar(root, gif, 'GET')
    expect(served.headers.get('content-type')).toBe('image/gif')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(GIF89A)
    restoreOrbAvatar(root)
    expect(orbAvatarCacheToken(root)).toBe(0)
    const fallback = writeImage(root, DEFAULT_ORB_AVATAR_FILE, GIF89A)
    const restored = await serveOrbAvatar(root, fallback, 'HEAD')
    expect(restored.status).toBe(200)
    expect(await restored.arrayBuffer()).toEqual(new ArrayBuffer(0))
  })

  it('rejects files over 2 MB and unknown types', () => {
    const root = profile()
    const huge = writeImage(root, 'huge.gif', new Uint8Array(MAX_ORB_AVATAR_BYTES + 1))
    expect(installOrbAvatarFromPath(root, huge)).toEqual({ ok: false, error: 'too-large' })
    const text = writeImage(root, 'note.gif', new Uint8Array([0x68, 0x69]))
    expect(installOrbAvatarFromPath(root, text)).toEqual({ ok: false, error: 'invalid-type' })
    expect(installOrbAvatarFromPath(root, join(root, 'missing.gif'))).toEqual({
      ok: false, error: 'invalid-type',
    })
  })

  it('builds cache-busted custom-protocol URLs and gates writes to macOS and Windows', () => {
    expect(orbAvatarUrl('app', 12.9)).toBe('dsh-app://app/orb-avatar?v=12')
    expect(orbAvatarUrl('shell', 0)).toBe('dsh-app://shell/orb-avatar?v=0')
    expect(orbSettingsSupported('darwin')).toBe(true)
    expect(orbSettingsSupported('win32')).toBe(true)
    expect(orbSettingsSupported('linux')).toBe(false)
    expect(() => { assertOrbSettingsWritable('linux') }).toThrow(ORB_SETTINGS_MACOS_ONLY)
    expect(() => { assertOrbSettingsWritable('darwin') }).not.toThrow()
    expect(() => { assertOrbSettingsWritable('win32') }).not.toThrow()
  })

  it('rejects non-GET methods and falls back when stored bytes are not an image', async () => {
    const root = profile()
    const fallback = writeImage(root, DEFAULT_ORB_AVATAR_FILE, GIF89A)
    expect((await serveOrbAvatar(root, fallback, 'POST')).status).toBe(405)
    writeFileSync(join(root, ORB_AVATAR_BYTES_FILE), new Uint8Array([0x6e, 0x6f]))
    writeFileSync(join(root, ORB_AVATAR_META_FILE), `${JSON.stringify({ mime: 'image/gif' }, undefined, 2)}\n`)
    const served = await serveOrbAvatar(root, fallback, 'GET')
    expect(served.headers.get('content-type')).toBe('image/gif')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(GIF89A)
  })
})
