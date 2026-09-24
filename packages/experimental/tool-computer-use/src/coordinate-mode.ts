/**
 * Per-session Computer Use click encoding: millifraction 0–1000 or attached-raster pixels.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/coordinate-mode
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ContextFormed, ToolSchema } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'computer-use': { kind: 'computer-use' } & ContextFormed
  }
}

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'

/** Click encoding recorded on a Computer Use session. */
export type CoordinateMode = 'millifraction' | 'pixel'

/** Attached observation raster used as the pixel click space. */
export interface ObservationRaster {
  readonly width: number
  readonly height: number
}

/** Canonical tool-result fields that fork render copy and the next envelope. */
export interface CoordinateOutcome {
  readonly coordinateMode: CoordinateMode
  readonly attachedWidth?: number
  readonly attachedHeight?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Click encoding for this Computer Use session: millifraction 0–1000 or
     * attached-raster pixels. Whole-value replace; the last event wins. A log
     * with none folds to millifraction. Not ignorable: a reader that skipped
     * it would mis-map stored `position` arrays.
     */
    'computer-use/coordinate-mode': { mode: CoordinateMode }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Folded Computer Use click encoding. */
    computerUseCoordinateMode: { mode: CoordinateMode }
  }
}

const COORDINATE_MODE_STATE_SCHEMA: ZodType<{ mode: CoordinateMode }> = zod.object({
  mode: zod.enum(['millifraction', 'pixel']),
}).strict()

/** Projection unit folding `'computer-use/coordinate-mode'` to the last logged encoding. */
export const coordinateModeProjection = {
  key: 'computerUseCoordinateMode',
  stateVersion: 1,
  stateSchema: COORDINATE_MODE_STATE_SCHEMA,
  init: () => ({ mode: 'millifraction' as const }),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'computer-use/coordinate-mode') return state
    if (event.data.mode === state.mode) return state
    return { mode: event.data.mode }
  },
} satisfies ProjectionDefinition<'computerUseCoordinateMode', { mode: CoordinateMode }>

interface OrbCoordinateMode {
  currentMode(): CoordinateMode
}

const observationCache = new WeakMap<object, ObservationRaster | false>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Last image raster in a content tree (observation envelopes, nested tool-result blocks).
 * @param value - message content or a nested block.
 * @returns the last image width/height, when any.
 */
function lastRasterIn(value: unknown): ObservationRaster | undefined {
  if (Array.isArray(value)) {
    let found: ObservationRaster | undefined
    for (const entry of value) {
      const raster = lastRasterIn(entry)
      if (raster !== undefined) found = raster
    }
    return found
  }
  if (!isRecord(value)) return undefined
  if (value.type === 'image' && isRecord(value.attachment)) {
    const width = value.attachment.width
    const height = value.attachment.height
    if (typeof width === 'number' && typeof height === 'number'
      && Number.isFinite(width) && Number.isFinite(height)
      && width > 0 && height > 0) {
      return { width, height }
    }
  }
  let found: ObservationRaster | undefined
  for (const nested of Object.values(value)) {
    const raster = lastRasterIn(nested)
    if (raster !== undefined) found = raster
  }
  return found
}

/**
 * Reconstruct the last Computer Use observation raster from the session log.
 * @param session - session whose events may include first-frame notices or GUI results.
 * @returns attached width/height, or undefined when no CU image remains.
 */
function reconstructFromLog(session: Session): ObservationRaster | undefined {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind !== 'computer-use' || source.form !== 'notice') continue
      const raster = lastRasterIn(event.data.content)
      if (raster !== undefined) return raster
    }
    if (event.type === 'tool/result') {
      const raster = lastRasterIn(event.data.message.content)
      if (raster !== undefined) return raster
    }
  }
  return undefined
}

/**
 * Logged encoding when a `'computer-use/coordinate-mode'` event exists.
 * @param session - session to scan, or a test stub.
 * @returns the last logged mode, or undefined when the log has none.
 */
export function loggedCoordinateMode(session: Session | undefined): CoordinateMode | undefined {
  const events = session?.snapshotEvents?.()
  if (events === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'computer-use/coordinate-mode') return event.data.mode
  }
  return undefined
}

/**
 * Click encoding in force for a request. Missing event, missing session, and
 * Headless/Web logs without a stamp all read as millifraction.
 * @param session - the session being assembled or executed.
 * @returns millifraction or pixel.
 */
export function coordinateModeOf(session: Session | undefined): CoordinateMode {
  return loggedCoordinateMode(session) ?? 'millifraction'
}

/**
 * Remember the attached raster from an observation so the next pixel click can divide by it.
 * @param session - session that received the observation; omitted on stubs without identity.
 * @param screens - captured screens; empty clears the raster (fail closed).
 */
export function rememberObservation(
  session: Session | undefined,
  screens: readonly { readonly image: { readonly width: number; readonly height: number } }[],
): void {
  if (session === undefined) return
  const first = screens[0]?.image
  observationCache.set(session, first === undefined ? false : { width: first.width, height: first.height })
}

/**
 * Attached raster the model is looking at: live cache, else last CU image in the log.
 * @param session - session whose last observation is needed.
 * @returns width/height, or undefined when pixel mapping must fail.
 */
export function lastAttachedRaster(session: Session | undefined): ObservationRaster | undefined {
  if (session === undefined) return undefined
  const cached = observationCache.get(session)
  if (cached === false) return undefined
  if (cached !== undefined) return cached
  if (typeof session.snapshotEvents !== 'function') return undefined
  const reconstructed = reconstructFromLog(session)
  observationCache.set(session, reconstructed === undefined ? false : reconstructed)
  return reconstructed
}

/**
 * Canonical coordinate fields stored on a GUI tool result.
 * @param session - calling session.
 * @param screens - recapture screens; pixel mode names the first attached raster.
 * @returns coordinateMode plus optional attachedWidth/Height.
 */
export function coordinateOutcome(
  session: Session | undefined,
  screens: readonly { readonly image: { readonly width: number; readonly height: number } }[],
): CoordinateOutcome {
  const mode = coordinateModeOf(session)
  const first = screens[0]?.image
  if (mode === 'pixel' && first !== undefined) {
    return { coordinateMode: mode, attachedWidth: first.width, attachedHeight: first.height }
  }
  return { coordinateMode: mode }
}

/**
 * Model-facing sentence that the next click still uses this session's encoding.
 * @param outcome - canonical result fields.
 * @returns millifraction or pixel remain-copy.
 */
export function coordinatesRemain(outcome: CoordinateOutcome): string {
  if (outcome.coordinateMode === 'pixel') {
    if (outcome.attachedWidth !== undefined && outcome.attachedHeight !== undefined) {
      return `Coordinates remain pixels of the attached ${String(outcome.attachedWidth)}x${String(outcome.attachedHeight)} screenshot.`
    }
    return 'Coordinates remain pixels of the attached screenshot.'
  }
  return 'Coordinates remain 0–1000.'
}

/**
 * First-frame plugin notice that names this session's click space.
 * @param mode - session contract.
 * @returns millifraction or pixel notice text.
 */
export function firstFrameNotice(mode: CoordinateMode): string {
  if (mode === 'pixel') {
    return 'Current frontmost window. Coordinates are pixel columns and rows of this screenshot ([0, 0] top-left). Use attached_size on the observation envelope. Do not send 0–1000 fractions.'
  }
  return 'Current frontmost window. Coordinates are 0–1000 fractions of this screenshot ([0, 0] top-left, [1000, 1000] bottom-right). Center x is 500, not a pixel x.'
}

const PIXEL_POSITION = '[x, y] as pixel columns and rows of the attached screenshot named on that observation, not a 0–1000 fraction.'
const PIXEL_FOCUS_POSITION = `${PIXEL_POSITION} The click focuses the field.`
const PIXEL_START_POSITION = '[x, y] start as pixel columns and rows of the attached screenshot named on that observation, not a 0–1000 fraction.'
const PIXEL_END_POSITION = '[x, y] end as pixel columns and rows of the attached screenshot named on that observation, not a 0–1000 fraction.'

const PIXEL_TOOLS: Readonly<Record<string, { description: string; parameters: Record<string, string> }>> = {
  click: {
    description:
      'Click at a pixel position on the attached frontmost-window screenshot, then return the post-action screenshot. '
      + 'Use left (default) or right button; count 2 is a double-click. '
      + 'Optional modifiers (shift, cmd, option, control) are held only for this click.',
    parameters: { position: PIXEL_POSITION },
  },
  input_text: {
    description:
      'Click to focus a pixel position on the attached frontmost-window screenshot, type text, optionally replace existing content and press Enter, then return the post-action screenshot.',
    parameters: { position: PIXEL_FOCUS_POSITION },
  },
  scroll: {
    description:
      'Scroll up or down at a pixel position on the attached frontmost-window screenshot, then return the post-action screenshot. scroll_level is 1–10.',
    parameters: { position: PIXEL_POSITION },
  },
  long_press: {
    description:
      'Press and hold the left button at a pixel position on the attached frontmost-window screenshot, then return the post-action screenshot. '
      + 'duration_seconds defaults to 3 and must be 1–10.',
    parameters: { position: PIXEL_POSITION },
  },
  drag: {
    description:
      'Drag from a start pixel position to an end pixel position on the attached frontmost-window screenshot, then return the post-action screenshot.',
    parameters: {
      start_position: PIXEL_START_POSITION,
      end_position: PIXEL_END_POSITION,
    },
  },
}

function rewritePixelTool(tool: ToolSchema): ToolSchema {
  const copy = PIXEL_TOOLS[tool.name]
  if (copy === undefined) return tool
  const parameters = structuredClone(tool.parameters) as Record<string, unknown>
  const properties = parameters.properties
  if (isRecord(properties)) {
    for (const [name, description] of Object.entries(copy.parameters)) {
      const field = properties[name]
      if (isRecord(field)) field.description = description
    }
  }
  return { ...tool, description: copy.description, parameters }
}

/**
 * Rewrite assembled `position` tool schemas for a pixel-mode session.
 * Millifraction assemblies keep the registered 0–1000 copy.
 * @param tools - assembled tool schemas.
 * @param mode - session contract.
 * @returns tools with pixel `position` copy when `mode` is pixel.
 */
export function toolsForCoordinateMode(tools: readonly ToolSchema[], mode: CoordinateMode): ToolSchema[] {
  if (mode === 'millifraction') return [...tools]
  return tools.map(rewritePixelTool)
}

function hasCoordinateModeEvent(session: Session): boolean {
  return session.snapshotEvents().some(event => event.type === 'computer-use/coordinate-mode')
}

function hasEndSeed(session: Session): boolean {
  return session.snapshotEvents().some(event => event.type === 'session/end-seed')
}

/**
 * Stamp a blank overlay create with the Desktop default encoding.
 * History adopt / resume (an `session/end-seed` is already in the log) and a
 * log that already has `'computer-use/coordinate-mode'` are left unchanged.
 * Headless/Web omit `orbCoordinateMode` and do not write the event.
 * @param ctx - plugin context; optional `orbCoordinateMode` is Desktop-only.
 * @param session - newly created Computer Use session.
 */
export function stampCoordinateMode(ctx: Context, session: Session): void {
  if (hasCoordinateModeEvent(session) || hasEndSeed(session)) return
  const service = ctx.get('orbCoordinateMode') as OrbCoordinateMode | undefined
  if (service === undefined) return
  session.append('computer-use/coordinate-mode', { mode: service.currentMode() })
}

/**
 * Register the coordinate-mode projection when the host composes session-projection,
 * and stamp blank Computer Use agents at `agent/created`.
 * @param ctx - Computer Use standing mount.
 */
export function installCoordinateMode(ctx: Context): void {
  const projections = ctx.get('sessionProjections')
  if (projections !== undefined) {
    projections.register(coordinateModeProjection)
  } else {
    ctx.inject(['sessionProjections'], (scoped) => {
      scoped.sessionProjections.register(coordinateModeProjection)
    })
  }
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    stampCoordinateMode(ctx, agent.session)
  })
}
