/**
 * Capture the frontmost window, persist it, and build model-facing image content.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/observe
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CapturedScreen, DesktopBackend, DesktopForeground, ScreenInfo } from './backend.ts'
import { FOCUS_FALLBACK_FOREGROUND } from './backend.ts'
import { delay } from './wait.ts'

/** Canonical image metadata stored beside one captured screen. */
export interface ObservedImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: {
    width: number
    height: number
  }
}

/** One captured display plus its durable attachment. */
export interface ObservedScreen {
  screenIndex: number
  logicalWidth: number
  logicalHeight: number
  scale: number
  image: ObservedImage
}

/** Capture outcome used by first-frame notices and GUI tool results. */
export interface DesktopObservation {
  readonly screens: readonly ObservedScreen[]
  readonly foreground: DesktopForeground
  readonly blocks: ContentBlock[]
  /** Encoded rasters in the same order as {@link screens}, before attachment downscale. */
  readonly captures: readonly CapturedScreen[]
}

const IMAGE_NAME_PREFIX = 'desktop-screen'

function isObservationAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function optionalImageFields(image: {
  name?: string
  originalDimensions?: { width: number; height: number }
}): Pick<ObservedImage, 'name' | 'originalDimensions'> {
  return {
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    },
  }
}

/**
 * Re-brand stored image metadata into the attachment reference an `ImageBlock` carries.
 * @param image - canonical image metadata.
 * @returns the branded attachment reference.
 */
export function imageRefFromObserved(image: ObservedImage): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...optionalImageFields(image),
  }
}

function envelopeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Format OS foreground metadata as one observation-level envelope.
 * Empty folder, title, and note fields are omitted. Screenshot filesystem paths are never included.
 * @param foreground - inspect result after overlay-window skip.
 * @returns model-facing tags for app name, optional window title, optional Finder folder, or focus fallback.
 */
export function formatForegroundEnvelope(foreground: DesktopForeground): string {
  const appName = envelopeValue(foreground.appName) || 'none'
  const lines = [`<frontmost_app>${appName}</frontmost_app>`]
  if (foreground.windowTitle !== undefined) {
    const title = envelopeValue(foreground.windowTitle)
    if (title !== '') lines.push(`<frontmost_window>${title}</frontmost_window>`)
  }
  if (foreground.focusNote !== undefined) {
    const note = envelopeValue(foreground.focusNote)
    if (note !== '') lines.push(`<focus_note>${note}</focus_note>`)
    return lines.join('\n')
  }
  if (foreground.finderFolder !== undefined) {
    const folder = envelopeValue(foreground.finderFolder)
    if (folder !== '') lines.push(`<frontmost_folder>${folder}</frontmost_folder>`)
  }
  return lines.join('\n')
}

/**
 * Copy foreground fields that schema validation accepts (`undefined` keys omitted).
 * @param foreground - inspect result stored on the observation.
 * @returns a tool-output object with only defined optional fields.
 */
export function compactForeground(foreground: DesktopForeground): DesktopForeground {
  return {
    appName: foreground.appName,
    ...foreground.windowTitle === undefined ? {} : { windowTitle: foreground.windowTitle },
    ...foreground.finderFolder === undefined ? {} : { finderFolder: foreground.finderFolder },
    ...foreground.focusNote === undefined ? {} : { focusNote: foreground.focusNote },
  }
}

/**
 * Format one screen as model-facing envelope text. Paths and pixel sizes are omitted
 * so the model uses the 0–1000 space of the attached screenshot, not capture rasters.
 * @param screen - captured display and attached image.
 * @returns envelope text naming index and the 0–1000 space.
 */
export function formatScreenEnvelope(screen: ObservedScreen): string {
  return `<screen_index>${String(screen.screenIndex)}</screen_index>
<coordinate_space>0-1000</coordinate_space>`
}

/**
 * Project captured screens into alternating envelope text and image blocks.
 * @param screens - captured displays in index order.
 * @returns model-facing content with no filesystem path.
 */
export function observationBlocks(screens: readonly ObservedScreen[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const screen of screens) {
    blocks.push({ type: 'text', text: formatScreenEnvelope(screen) })
    blocks.push({ type: 'image', attachment: imageRefFromObserved(screen.image) })
  }
  return blocks
}

/**
 * Observation content: one foreground block, then per-screen envelopes and images.
 * @param screens - captured displays in index order.
 * @param foreground - OS metadata from {@link DesktopBackend.inspectForeground}.
 * @returns model-facing content with no screenshot filesystem path.
 */
export function observationContent(
  screens: readonly ObservedScreen[],
  foreground: DesktopForeground,
): ContentBlock[] {
  return [
    { type: 'text', text: formatForegroundEnvelope(foreground) },
    ...observationBlocks(screens),
  ]
}

/**
 * Capture the overlay-skipped frontmost window, persist the image, and build content blocks.
 * When no operable window remains, returns focus tags with no screenshot.
 * @param ctx - plugin context with `attachments`.
 * @param backend - desktop capture implementation.
 * @param signal - cooperative cancellation.
 * @param options - optional settle wait applied after inspect and immediately before capture.
 * @returns canonical screens, foreground metadata, and model-facing blocks.
 */
export async function observeDesktop(
  ctx: Context,
  backend: DesktopBackend,
  signal: AbortSignal,
  options: { settleMs?: number } = {},
): Promise<DesktopObservation> {
  signal.throwIfAborted()
  const listed = await backend.listScreens(signal)
  const selected = listed.slice(0, 1)
  let foreground = FOCUS_FALLBACK_FOREGROUND
  try {
    foreground = await backend.inspectForeground(signal)
  } catch (error: unknown) {
    if (isObservationAbort(error, signal)) throw error
  }
  const screens: ObservedScreen[] = []
  const captures: CapturedScreen[] = []
  const settleMs = options.settleMs ?? 0
  if (selected.length > 0 && settleMs > 0) await delay(settleMs, signal)
  for (const screen of selected) {
    signal.throwIfAborted()
    const captured = await backend.capture(screen, signal)
    captures.push(captured)
    const saved = await ctx.attachments.saveImage({
      data: captured.data,
      mediaType: captured.mediaType,
      name: `${IMAGE_NAME_PREFIX}-${String(screen.index)}`,
    })
    screens.push({
      screenIndex: screen.index,
      logicalWidth: screen.bounds.width,
      logicalHeight: screen.bounds.height,
      scale: screen.scale,
      image: {
        attachmentId: saved.attachmentId,
        mediaType: saved.mediaType,
        bytes: saved.bytes,
        width: saved.width,
        height: saved.height,
        ...optionalImageFields(saved),
      },
    })
  }
  return {
    screens,
    foreground,
    blocks: observationContent(screens, foreground),
    captures,
  }
}

/**
 * Resolve a screen_index against the current observation surface list.
 * @param screens - backend surface list.
 * @param screenIndex - model-supplied index.
 * @returns the matching screen.
 * @throws when the index is missing.
 */
export function requireScreen(screens: readonly ScreenInfo[], screenIndex: number): ScreenInfo {
  const screen = screens.find(candidate => candidate.index === screenIndex)
  if (screen === undefined) {
    const last = screens.at(-1)
    const range = last === undefined ? 'none' : `0..${String(last.index)}`
    throw new Error(`computer-use: screen_index ${String(screenIndex)} is out of range (${range})`)
  }
  return screen
}
