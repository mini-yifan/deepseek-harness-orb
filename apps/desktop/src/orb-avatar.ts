/** Persist and serve a user-chosen floating-ball image from the Desktop profile. */

import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** Profile-relative file holding the custom avatar bytes. */
export const ORB_AVATAR_BYTES_FILE = 'orb-avatar'

/** Profile-relative JSON naming the custom avatar MIME type. */
export const ORB_AVATAR_META_FILE = 'orb-avatar.json'

/** Packaged GIF used when no custom avatar is stored. */
export const DEFAULT_ORB_AVATAR_FILE = 'deepseek-avatar-square.gif'

/** Custom-protocol pathname that serves the live ball image. */
export const ORB_AVATAR_PATH = '/orb-avatar'

/** Suggested maximum size for a custom ball image. */
export const MAX_ORB_AVATAR_BYTES = 2 * 1024 * 1024

/** Writes that change live overlay state require macOS or Windows. */
export const ORB_SETTINGS_MACOS_ONLY = 'dsh desktop: floating ball settings require macOS or Windows'

/**
 * Whether this OS creates the floating ball.
 * @param platform - Node `process.platform`.
 * @returns true on macOS and Windows.
 */
export function orbSettingsSupported(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Refuse overlay preference writes on Linux.
 * @param platform - Node `process.platform`.
 * @throws when {@link orbSettingsSupported} is false.
 */
export function assertOrbSettingsWritable(platform: NodeJS.Platform): void {
  if (!orbSettingsSupported(platform)) throw new Error(ORB_SETTINGS_MACOS_ONLY)
}

/** MIME types the ball image accepts. */
export type OrbAvatarMime = 'image/gif' | 'image/png' | 'image/webp'

/** Why installing a custom avatar failed. */
export type OrbAvatarInstallError = 'too-large' | 'invalid-type'

const MIME_BY_EXTENSION: Readonly<Record<string, OrbAvatarMime>> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/**
 * Build a cache-busted avatar URL for one custom-protocol hostname.
 * @param hostname - `app` for the main window or `shell` for the floating renderer.
 * @param version - mtime of the custom file, or 0 when the packaged GIF is in use.
 * @returns `dsh-app://<hostname>/orb-avatar?v=<version>`.
 */
export function orbAvatarUrl(hostname: string, version: number): string {
  return `dsh-app://${hostname}${ORB_AVATAR_PATH}?v=${String(Math.trunc(version))}`
}

/**
 * Cache token for the live ball image.
 * @param profileDir - Desktop profile directory.
 * @returns custom-file mtime in milliseconds, or 0 for the packaged GIF.
 */
export function orbAvatarCacheToken(profileDir: string): number {
  try {
    return statSync(join(profileDir, ORB_AVATAR_BYTES_FILE)).mtimeMs
  } catch {
    // Missing custom bytes mean the packaged GIF is in use.
    return 0
  }
}

/**
 * Classify file bytes as a supported ball image.
 * @param bytes - file contents.
 * @param filePath - original path; its extension must agree with the magic bytes.
 * @returns the MIME type, or undefined when the file is not a GIF, PNG, or WebP.
 */
export function interpretOrbAvatarBytes(bytes: Uint8Array, filePath: string): OrbAvatarMime | undefined {
  const sniffed = sniffOrbAvatarMime(bytes)
  if (sniffed === undefined) return undefined
  const fromName = MIME_BY_EXTENSION[extname(filePath).toLowerCase()]
  if (fromName !== undefined && fromName !== sniffed) return undefined
  return sniffed
}

/**
 * Copy a picked image into the profile after size and type checks.
 * @param profileDir - Desktop profile directory.
 * @param filePath - absolute path chosen in the open dialog.
 * @returns success, or a reason the file was rejected.
 */
export function installOrbAvatarFromPath(
  profileDir: string,
  filePath: string,
): { ok: true } | { ok: false; error: OrbAvatarInstallError } {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    // A path the dialog returned that cannot be stat'd is not a usable image.
    return { ok: false, error: 'invalid-type' }
  }
  if (size > MAX_ORB_AVATAR_BYTES) return { ok: false, error: 'too-large' }
  const bytes = new Uint8Array(readFileSync(filePath))
  const mime = interpretOrbAvatarBytes(bytes, filePath)
  if (mime === undefined) return { ok: false, error: 'invalid-type' }
  writeCustomOrbAvatar(profileDir, bytes, mime)
  return { ok: true }
}

/**
 * Delete a custom ball image so the packaged GIF is served again.
 * @param profileDir - Desktop profile directory.
 */
export function restoreOrbAvatar(profileDir: string): void {
  for (const name of [ORB_AVATAR_BYTES_FILE, ORB_AVATAR_META_FILE]) {
    try {
      unlinkSync(join(profileDir, name))
    } catch (error) {
      // Already-restored profiles have no custom files to delete.
      if (!isEnoent(error)) throw error
    }
  }
}

/**
 * Serve the live ball image for GET or HEAD.
 * @param profileDir - Desktop profile directory.
 * @param defaultFilePath - packaged GIF on disk.
 * @param method - HTTP method of the custom-protocol request.
 * @returns the custom image when present and valid, otherwise the packaged GIF.
 */
export async function serveOrbAvatar(
  profileDir: string,
  defaultFilePath: string,
  method: string,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 })
  const custom = readCustomOrbAvatar(profileDir)
  const mime = custom?.mime ?? 'image/gif'
  try {
    const body = method === 'HEAD'
      ? null
      : custom !== undefined
        ? Buffer.from(custom.bytes)
        : await readFile(defaultFilePath)
    return new Response(body, {
      headers: {
        'content-type': mime,
        'cache-control': 'no-store',
      },
    })
  } catch {
    // A missing packaged GIF is a 404 the protocol handler already maps.
    return new Response(null, { status: 404 })
  }
}

function writeCustomOrbAvatar(profileDir: string, bytes: Uint8Array, mime: OrbAvatarMime): void {
  writeFileSync(join(profileDir, ORB_AVATAR_BYTES_FILE), bytes)
  writeFileSync(
    join(profileDir, ORB_AVATAR_META_FILE),
    `${JSON.stringify({ mime }, undefined, 2)}\n`,
  )
}

function readCustomOrbAvatar(
  profileDir: string,
): { bytes: Uint8Array; mime: OrbAvatarMime } | undefined {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(join(profileDir, ORB_AVATAR_BYTES_FILE)))
  } catch {
    // No custom bytes: serve the packaged GIF.
    return undefined
  }
  let mime: OrbAvatarMime | undefined
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, ORB_AVATAR_META_FILE), 'utf8'))
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as { mime?: unknown }
      if (record.mime === 'image/gif' || record.mime === 'image/png' || record.mime === 'image/webp') {
        mime = record.mime
      }
    }
  } catch {
    // Invalid metadata falls through to a sniff of the stored bytes.
  }
  const sniffed = sniffOrbAvatarMime(bytes)
  if (sniffed === undefined) return undefined
  if (mime !== undefined && mime !== sniffed) return undefined
  return { bytes, mime: mime ?? sniffed }
}

function sniffOrbAvatarMime(bytes: Uint8Array): OrbAvatarMime | undefined {
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif'
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
