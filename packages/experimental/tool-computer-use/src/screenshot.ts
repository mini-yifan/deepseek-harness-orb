/**
 * Write captured desktop rasters to the user's Desktop with unique filenames.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/screenshot
 */

import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** One captured display to persist as a user-visible file. */
export interface DesktopScreenshotFile {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
  readonly screenIndex: number
}

const EXTENSION: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * macOS-style Screenshot stamp used as the Desktop filename stem.
 * @param now - local time used in the stamp.
 * @param screenIndex - display index from the observation.
 * @param screenCount - how many displays this capture wrote.
 * @returns filename stem without extension.
 */
export function screenshotFileStem(
  now: Date,
  screenIndex: number,
  screenCount: number,
): string {
  const stamp = `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    + ` at ${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}`
  if (screenCount === 1) return `Screenshot ${stamp}`
  return `Screenshot ${stamp} (screen ${String(screenIndex)})`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    // Missing and unreadable paths both look absent here; writeFile reports the real error.
    return false
  }
}

async function uniquePath(directory: string, stem: string, extension: string): Promise<string> {
  let candidate = join(directory, `${stem}.${extension}`)
  for (let suffix = 2; suffix <= 101; suffix += 1) {
    if (!await pathExists(candidate)) return candidate
    if (suffix > 100) break
    candidate = join(directory, `${stem} ${String(suffix)}.${extension}`)
  }
  throw new Error('computer-use: could not allocate a unique screenshot filename')
}

/**
 * Pair capture rasters with observation screen indexes.
 * @param captures - rasters in screen order.
 * @param screens - observation envelopes in the same order.
 * @returns files ready for {@link writeDesktopScreenshots}.
 */
export function pairScreenshotFiles(
  captures: readonly Pick<DesktopScreenshotFile, 'data' | 'mediaType'>[],
  screens: readonly { readonly screenIndex: number }[],
): DesktopScreenshotFile[] {
  if (captures.length !== screens.length) {
    throw new Error('computer-use: screenshot captures and screens disagree')
  }
  const files: DesktopScreenshotFile[] = []
  for (const [index, captured] of captures.entries()) {
    const screen = screens[index]
    if (screen === undefined) {
      throw new Error('computer-use: screenshot captures and screens disagree')
    }
    files.push({
      data: captured.data,
      mediaType: captured.mediaType,
      screenIndex: screen.screenIndex,
    })
  }
  return files
}

/**
 * Write each captured display onto the user's Desktop.
 * @param files - captured rasters in screen order.
 * @param options.home - home directory whose Desktop receives the files.
 * @param options.now - local timestamp used in the filename stamp; default `new Date()`.
 * @returns absolute paths in the same order as `files`.
 */
export async function writeDesktopScreenshots(
  files: readonly DesktopScreenshotFile[],
  options: { home: string; now?: Date },
): Promise<readonly string[]> {
  if (files.length === 0) throw new Error('computer-use: no screenshot files to write')
  const home = options.home
  const now = options.now ?? new Date()
  const desktop = join(home, 'Desktop')
  await fs.mkdir(desktop, { recursive: true })
  const paths: string[] = []
  for (const file of files) {
    const stem = screenshotFileStem(now, file.screenIndex, files.length)
    const path = await uniquePath(desktop, stem, EXTENSION[file.mediaType])
    await fs.writeFile(path, file.data)
    paths.push(path)
  }
  return paths
}
