/** Persist and serve the floating-ball image (built-in preset or user upload) from the Desktop profile. */

import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** Profile-relative file holding the custom avatar bytes. */
export const ORB_AVATAR_BYTES_FILE = 'orb-avatar'

/** Profile-relative JSON file that is the single source of truth for the ball image. */
export const ORB_AVATAR_META_FILE = 'orb-avatar.json'

/** Packaged GIF used when no preset is selected and no custom image is stored. */
export const DEFAULT_ORB_AVATAR_FILE = 'deepseek-avatar-square.gif'

/** Renderer-relative directory holding the built-in animated avatars. */
export const ORB_AVATAR_PRESETS_DIR = 'assets/avatars'

/** Custom-protocol pathname that serves the live ball image. */
export const ORB_AVATAR_PATH = '/orb-avatar'

/** Custom-protocol pathname prefix that serves one built-in preset for the Settings gallery. */
export const ORB_AVATAR_PRESET_PATH = '/orb-avatar/preset'

/** Built-in animated ball avatars, in gallery order. */
export const ORB_AVATAR_PRESETS = ['point', 'rice', 'heart', 'cheer', 'cheeks', 'smile'] as const

/** One built-in animated ball avatar id. */
export type OrbAvatarPreset = (typeof ORB_AVATAR_PRESETS)[number]

/**
 * Whether `value` names a built-in avatar.
 * @param value - candidate id.
 * @returns true for one of {@link ORB_AVATAR_PRESETS}.
 */
export function isOrbAvatarPreset(value: unknown): value is OrbAvatarPreset {
  return typeof value === 'string' && (ORB_AVATAR_PRESETS as readonly string[]).includes(value)
}

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

/** Current ball-image selection: a built-in, the packaged default, or an uploaded image. */
export type OrbAvatarSelection =
  | { readonly kind: 'default' }
  | { readonly kind: 'preset'; readonly preset: OrbAvatarPreset }
  | { readonly kind: 'custom'; readonly mime: OrbAvatarMime; readonly bytes: Uint8Array }

/** Absolute files the avatar routes serve from the application bundle. */
export interface OrbAvatarFiles {
  /** Packaged default GIF. */
  readonly defaultFile: string
  /**
   * Absolute path of one built-in preset GIF.
   * @param preset - built-in avatar id.
   */
  readonly presetFile: (preset: OrbAvatarPreset) => string
}

const MIME_BY_EXTENSION: Readonly<Record<string, OrbAvatarMime>> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/**
 * Build a cache-busted avatar URL for one custom-protocol hostname.
 * @param hostname - `app` for the main window or `shell` for the floating renderer.
 * @param version - mtime of the stored selection, or 0 when nothing is stored.
 * @returns `dsh-app://<hostname>/orb-avatar?v=<version>`.
 */
export function orbAvatarUrl(hostname: string, version: number): string {
  return `dsh-app://${hostname}${ORB_AVATAR_PATH}?v=${String(Math.trunc(version))}`
}

/**
 * URL of one built-in avatar for the Settings gallery.
 * @param preset - built-in avatar id.
 * @returns `dsh-app://app/orb-avatar/preset/<id>`.
 */
export function orbAvatarPresetUrl(preset: OrbAvatarPreset): string {
  return `dsh-app://app${ORB_AVATAR_PRESET_PATH}/${preset}`
}

/**
 * Cache token for the live ball image. The meta file wins because a preset selection
 * only writes metadata; an unchanged token would leave the ball on the old image.
 * @param profileDir - Desktop profile directory.
 * @returns newest stored mtime in milliseconds, or 0 when nothing is stored.
 */
export function orbAvatarCacheToken(profileDir: string): number {
  for (const name of [ORB_AVATAR_META_FILE, ORB_AVATAR_BYTES_FILE]) {
    try {
      return statSync(join(profileDir, name)).mtimeMs
    } catch {
      // Fall through to the next stored file.
    }
  }
  return 0
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
 * Copy a picked image into the profile after size and type checks. Uploads replace
 * a preset selection: one profile has one ball image.
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
 * Select one built-in avatar. Selecting a built-in removes uploaded bytes, because
 * one profile has one ball image.
 * @param profileDir - Desktop profile directory.
 * @param preset - built-in avatar id.
 * @throws when the id is not a known preset; nothing is written in that case.
 */
export function writeOrbAvatarPreset(profileDir: string, preset: OrbAvatarPreset): void {
  if (!isOrbAvatarPreset(preset)) throw new Error(`dsh desktop: unknown orb avatar preset "${String(preset)}"`)
  writeFileSync(
    join(profileDir, ORB_AVATAR_META_FILE),
    `${JSON.stringify({ kind: 'preset', preset }, undefined, 2)}\n`,
  )
  removeCustomOrbAvatarBytes(profileDir)
}

/**
 * Delete the stored selection so the packaged GIF is served again.
 * @param profileDir - Desktop profile directory.
 */
export function restoreOrbAvatar(profileDir: string): void {
  for (const name of [ORB_AVATAR_BYTES_FILE, ORB_AVATAR_META_FILE]) {
    try {
      unlinkSync(join(profileDir, name))
    } catch (error) {
      // Already-restored profiles have no stored files to delete.
      if (!isEnoent(error)) throw error
    }
  }
}

/**
 * Read the current ball image, validating stored state every time. An unknown preset id
 * (a downgraded plugin or a removed asset) reads as the packaged default, never as stale
 * bytes the user replaced.
 * @param profileDir - Desktop profile directory.
 * @returns the selection with custom bytes when one is stored.
 */
export function readOrbAvatarSelection(profileDir: string): OrbAvatarSelection {
  const meta = readOrbAvatarMeta(profileDir)
  if (meta !== undefined && 'preset' in meta) {
    return isOrbAvatarPreset(meta.preset) ? { kind: 'preset', preset: meta.preset } : { kind: 'default' }
  }
  const bytes = readOrbAvatarBytes(profileDir)
  if (bytes === undefined) return { kind: 'default' }
  const sniffed = sniffOrbAvatarMime(bytes)
  if (sniffed === undefined) return { kind: 'default' }
  const declared = meta?.mime
  if (declared !== undefined && declared !== sniffed) return { kind: 'default' }
  return { kind: 'custom', mime: declared ?? sniffed, bytes }
}

/**
 * Serve the live ball image for GET or HEAD.
 * @param profileDir - Desktop profile directory.
 * @param files - packaged default and preset file resolver.
 * @param method - HTTP method of the custom-protocol request.
 * @returns the selected image, otherwise the packaged GIF.
 */
export async function serveOrbAvatar(
  profileDir: string,
  files: OrbAvatarFiles,
  method: string,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 })
  const selection = readOrbAvatarSelection(profileDir)
  const source = selection.kind === 'preset'
    ? { mime: 'image/gif' as const, path: files.presetFile(selection.preset), bytes: undefined }
    : selection.kind === 'custom'
      ? { mime: selection.mime, path: undefined, bytes: selection.bytes }
      : { mime: 'image/gif' as const, path: files.defaultFile, bytes: undefined }
  try {
    const body = method === 'HEAD'
      ? null
      : source.bytes !== undefined
        ? Buffer.from(source.bytes)
        : await readFile(source.path)
    return new Response(body, {
      headers: {
        'content-type': source.mime,
        'cache-control': 'no-store',
      },
    })
  } catch {
    // A missing packaged GIF is a 404 the protocol handler already maps.
    return new Response(null, { status: 404 })
  }
}

/**
 * Serve one built-in avatar for the Settings gallery.
 * @param files - packaged preset file resolver.
 * @param preset - requested preset id.
 * @param method - HTTP method of the custom-protocol request.
 * @returns the GIF, 404 for an unknown id, or 405 for other methods.
 */
export async function serveOrbAvatarPreset(
  files: OrbAvatarFiles,
  preset: string,
  method: string,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 })
  if (!isOrbAvatarPreset(preset)) return new Response(null, { status: 404 })
  try {
    const body = method === 'HEAD' ? null : await readFile(files.presetFile(preset))
    return new Response(body, {
      headers: {
        'content-type': 'image/gif',
        'cache-control': 'no-store',
      },
    })
  } catch {
    // A missing packaged preset is a 404 the protocol handler already maps.
    return new Response(null, { status: 404 })
  }
}

interface OrbAvatarMeta {
  readonly mime?: OrbAvatarMime
  readonly preset?: unknown
}

function readOrbAvatarMeta(profileDir: string): OrbAvatarMeta | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, ORB_AVATAR_META_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as { kind?: unknown; mime?: unknown; preset?: unknown }
    if (record.kind === 'preset') return { preset: record.preset }
    if (record.mime === 'image/gif' || record.mime === 'image/png' || record.mime === 'image/webp') {
      return { mime: record.mime }
    }
    return undefined
  } catch {
    // Missing or invalid metadata: fall back to stored bytes, then the packaged default.
    return undefined
  }
}

function readOrbAvatarBytes(profileDir: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(join(profileDir, ORB_AVATAR_BYTES_FILE)))
  } catch {
    // No custom bytes are stored.
    return undefined
  }
}

function writeCustomOrbAvatar(profileDir: string, bytes: Uint8Array, mime: OrbAvatarMime): void {
  writeFileSync(join(profileDir, ORB_AVATAR_BYTES_FILE), bytes)
  writeFileSync(
    join(profileDir, ORB_AVATAR_META_FILE),
    `${JSON.stringify({ kind: 'custom', mime }, undefined, 2)}\n`,
  )
}

function removeCustomOrbAvatarBytes(profileDir: string): void {
  try {
    unlinkSync(join(profileDir, ORB_AVATAR_BYTES_FILE))
  } catch (error) {
    // A profile that never uploaded one has no bytes to delete.
    if (!isEnoent(error)) throw error
  }
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
