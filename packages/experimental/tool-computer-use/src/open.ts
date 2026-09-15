/**
 * Model-JSON validation for `long_press` duration, `open_in_browser`, and `open_in_finder`.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/open
 */

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Inclusive hold duration for `long_press`, in seconds. */
export const LONG_PRESS_MIN_SECONDS = 1

/** Inclusive hold duration for `long_press`, in seconds. */
export const LONG_PRESS_MAX_SECONDS = 10

/** Default hold when `duration_seconds` is omitted. */
export const LONG_PRESS_DEFAULT_SECONDS = 3

const PATH_BLACKLIST = [
  '/System',
  '/private',
  '/etc',
  '/var',
  '/usr',
  '/sbin',
  '/bin',
  '/dev',
  '/proc',
  '/sys',
] as const

/** UTF-8 multi-byte percent-encoding such as `%E5%88%98`; sparse ASCII like `%20` is allowed. */
const MULTIBYTE_UTF8_PERCENT = /%(?:[Cc][2-9A-Fa-f]|[Dd][0-9A-Fa-f]|[Ee][0-9A-Fa-f]|[Ff][0-7])(?:%[0-9A-Fa-f]{2})+/u

/**
 * Whether `resolved` is a blocked system prefix.
 * @param resolved - absolute realpath.
 * @returns true when Finder/open must refuse the path.
 */
export function isForbiddenOpenPath(resolved: string): boolean {
  return PATH_BLACKLIST.some(prefix => resolved === prefix || resolved.startsWith(`${prefix}/`))
}

/**
 * Require `duration_seconds` in 1–10, defaulting to 3.
 * @param value - model-supplied duration, or undefined.
 * @returns the validated duration in seconds.
 * @throws when the value is not a finite number in 1–10.
 */
export function requireLongPressDuration(value: number | undefined): number {
  const duration = value ?? LONG_PRESS_DEFAULT_SECONDS
  if (!Number.isFinite(duration) || duration < LONG_PRESS_MIN_SECONDS || duration > LONG_PRESS_MAX_SECONDS) {
    throw new Error('duration_seconds must be a number from 1 to 10')
  }
  return duration
}

/**
 * Path and query of a URL string without decoding percent-encoding.
 * @param rawUrl - trimmed URL, with or without a scheme.
 * @returns the substring from the first `/` or `?` after the host, or the whole string.
 */
function urlPathAndQuery(rawUrl: string): string {
  const withScheme = /^https?:\/\//iu.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  const afterScheme = withScheme.replace(/^https?:\/\//iu, '')
  const pathStart = afterScheme.search(/[/?#]/u)
  return pathStart < 0 ? '' : afterScheme.slice(pathStart)
}

/**
 * Whether path or query contains CJK-style multi-byte percent-encoding.
 * @param rawUrl - model-supplied URL, with or without a scheme.
 * @returns true when the model must send plain CJK instead.
 */
export function browserUrlHasCjkPercentEncoding(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()
  if (trimmed === '') return false
  return MULTIBYTE_UTF8_PERCENT.test(urlPathAndQuery(trimmed))
}

/**
 * Require an http(s) URL, adding `https://` when the scheme is missing.
 * @param rawUrl - model-supplied URL.
 * @returns the scheme-normalized URL with CJK left as plain text.
 * @throws when the URL is empty, not http(s), includes userinfo, or uses CJK percent-encoding.
 */
export function requireBrowserUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed === '') throw new Error('url must be a non-empty http(s) URL when provided')
  if (browserUrlHasCjkPercentEncoding(trimmed)) {
    throw new Error(
      'url path and query must use plain CJK text, not percent-encoding such as %E5... / %E8...',
    )
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    throw new Error('url must be an http(s) URL')
  }
  const withScheme = scheme === undefined ? `https://${trimmed}` : trimmed
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('url must be a valid http(s) URL')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('url must not include userinfo')
  }
  return withScheme
}

/** Resolved Finder/open target after expand, realpath, and prefix checks. */
export interface FinderOpenTarget {
  readonly path: string
  readonly revealOnly: boolean
}

/**
 * Resolve `open_in_finder` arguments to an absolute realpath.
 * @param path - model-supplied path; omitted opens the user's Desktop.
 * @param revealOnly - reveal a file in Finder instead of opening it.
 * @param home - home directory used when `path` is omitted; default `os.homedir()`.
 * @returns the resolved path and reveal flag.
 * @throws when the path is missing, blacklisted, or cannot be resolved.
 */
export async function resolveFinderOpen(
  path: string | undefined,
  revealOnly: boolean,
  home: string = homedir(),
): Promise<FinderOpenTarget> {
  const trimmed = path === undefined ? '' : path.trim()
  const expanded = trimmed === '' || trimmed === '~'
    ? join(home, 'Desktop')
    : trimmed.startsWith('~/')
      ? join(home, trimmed.slice(2))
      : trimmed
  let resolved: string
  try {
    resolved = await realpath(expanded)
  } catch (error: unknown) {
    throw new Error(`computer-use: path does not exist: ${expanded} (${String(error)})`)
  }
  if (isForbiddenOpenPath(resolved)) {
    throw new Error(`computer-use: opening a system path is forbidden: ${resolved}`)
  }
  return { path: resolved, revealOnly }
}
