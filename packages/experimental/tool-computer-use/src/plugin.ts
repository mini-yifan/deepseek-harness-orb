/**
 * Register Computer Use tools, policy, and first-frame screenshot attachment.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/plugin
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CapturedScreen, ClickButton, DesktopBackend, DesktopForeground } from './backend.ts'
import type { ResolvedComputerUseConfig } from './config.ts'
import {
  coordinateModeOf,
  coordinateOutcome,
  coordinatesRemain,
  firstFrameNotice,
  installCoordinateMode,
  lastAttachedRaster,
  rememberObservation,
  toolsForCoordinateMode,
  type CoordinateOutcome,
} from './coordinate-mode.ts'
import {
  assertAllowedHotkey,
  modelPositionToHid,
  requireClickModifiers,
  requireNormalizedPosition,
  requirePixelPosition,
} from './coordinates.ts'
import {
  requireBrowserUrl,
  requireLongPressDuration,
  resolveFinderOpen,
} from './open.ts'
import {
  compactForeground,
  formatForegroundEnvelope,
  observationContent,
  observeDesktop,
  requireScreen,
  type ObservedScreen,
} from './observe.ts'
import { isUsableObservationRaster } from './raster.ts'
import { policyFor } from './policy.ts'
import { assertImageCapableRoute, routeAcceptsImages } from './route.ts'
import { isDesktopSelectionTurn } from './selection-turn.ts'
import { pairScreenshotFiles, writeDesktopScreenshots } from './screenshot.ts'
import { delay } from './wait.ts'
import { LONG_WAIT_SECONDS, WAIT_SECONDS, requireLongWaitSeconds } from './wait-args.ts'

import type {} from './overlay-guard.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used as the first-frame notice producer id. */
export const PLUGIN_NAME = 'tool-computer-use'

/** Prompt section sort order: after PTY guidance, before web search. */
export const POLICY_SECTION_ORDER = 1750

const SCREEN_IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: {
      type: 'string',
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      required: true,
    },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

const SCREEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    screenIndex: { type: 'integer', required: true },
    logicalWidth: { type: 'number', required: true },
    logicalHeight: { type: 'number', required: true },
    scale: { type: 'number', required: true },
    image: SCREEN_IMAGE_SCHEMA,
  },
} as const

const SCREENS_FIELD = {
  type: 'array',
  required: true,
  items: SCREEN_SCHEMA,
} as const

const FOREGROUND_FIELD = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    appName: { type: 'string', required: true },
    windowTitle: { type: 'string' },
    finderFolder: { type: 'string' },
    focusNote: { type: 'string' },
  },
} as const

const COORDINATE_FIELDS = {
  coordinateMode: {
    type: 'string',
    required: true,
    enum: ['millifraction', 'pixel'],
  },
  attachedWidth: { type: 'integer' },
  attachedHeight: { type: 'integer' },
} as const

function genericExecute(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'execute', rawInput }
}

function resultBlocks(
  intro: string,
  screens: readonly ObservedScreen[],
  foreground: DesktopForeground,
  outcome: CoordinateOutcome,
): ContentBlock[] {
  return [{ type: 'text', text: intro }, ...observationContent(screens, foreground, outcome.coordinateMode)]
}

function sessionOf(exec: ToolExecution): Session | undefined {
  return exec.agent?.session
}

function validatedPosition(exec: ToolExecution, position: readonly number[]): [number, number] {
  const session = sessionOf(exec)
  const mode = coordinateModeOf(session)
  if (mode === 'millifraction') return requireNormalizedPosition(position)
  const attached = lastAttachedRaster(session)
  if (attached === undefined) {
    throw new Error('computer-use: pixel coordinates require an attached screenshot raster')
  }
  return requirePixelPosition(position, attached)
}

function hidPosition(exec: ToolExecution, position: readonly number[]): [number, number] {
  const session = sessionOf(exec)
  const mode = coordinateModeOf(session)
  return modelPositionToHid(position, mode, mode === 'pixel' ? lastAttachedRaster(session) : undefined)
}

function observedFields(
  session: Session | undefined,
  observation: { screens: ObservedScreen[]; foreground: DesktopForeground },
): {
  screens: ObservedScreen[]
  foreground: DesktopForeground
} & CoordinateOutcome {
  return {
    screens: observation.screens,
    foreground: observation.foreground,
    ...coordinateOutcome(session, observation.screens),
  }
}

async function recapture(
  ctx: Context,
  backend: DesktopBackend,
  exec: ToolExecution,
  settleMs = 0,
): Promise<{
  screens: ObservedScreen[]
  foreground: DesktopForeground
  captures: CapturedScreen[]
}> {
  const session = sessionOf(exec)
  const mode = coordinateModeOf(session)
  const observation = await observeDesktop(ctx, backend, exec.signal, {
    settleMs,
    coordinateMode: mode,
  })
  rememberObservation(session, observation.screens)
  return {
    screens: [...observation.screens],
    foreground: compactForeground(observation.foreground),
    captures: [...observation.captures],
  }
}

/**
 * Hold overlay click-through across one HID or activate call and its recapture.
 * @param backend - desktop backend; Desktop wrap maps this to overlay-guard `withInput`.
 * @param signal - cooperative cancellation.
 * @param run - HID plus recapture.
 * @returns the value `run` resolves to.
 */
function guiTurn<T>(
  backend: DesktopBackend,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  return backend.withGuiTurn(run, signal)
}

function screenshotIntro(paths: readonly string[], outcome: CoordinateOutcome): string {
  return `Saved screenshot to ${paths[0]} and copied it to the clipboard. The image is ready to paste. ${coordinatesRemain(outcome)}`
}

function clickResultText(value: {
  readonly screenIndex: number
  readonly position: readonly number[]
  readonly button: string
  readonly count: number
  readonly modifiers?: readonly string[]
} & CoordinateOutcome): string {
  const mods = value.modifiers === undefined
    ? ''
    : `, modifiers ${value.modifiers.join(', ')}`
  return `Clicked screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (${value.button}, count ${String(value.count)}${mods}). ${coordinatesRemain(value)}`
}

/**
 * Register the exclusive GUI tools, the policy section, and first-frame screenshot attachment.
 * @param ctx - registration scope; requires `tools`, `systemPrompt`, and `attachments`.
 * @param backend - desktop capture and input.
 * @param config - resolved tunables.
 */
export function applyComputerUse(
  ctx: Context,
  backend: DesktopBackend,
  config: ResolvedComputerUseConfig,
): void {
  installCoordinateMode(ctx)
  ctx.systemPrompt.section({
    name: 'tool:computer-use',
    order: POLICY_SECTION_ORDER,
    text: context => policyFor(coordinateModeOf(context.agent?.session)),
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const nextAssembly = await next()
    const mode = coordinateModeOf(context.agent?.session)
    if (mode === 'millifraction') return nextAssembly
    return { ...nextAssembly, tools: toolsForCoordinateMode(nextAssembly.tools, mode) }
  })
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'turn/end') return
    const guard = ctx.get('computerUseOverlayGuard')
    if (guard === undefined) return
    void guard.setObservationFrame(null).catch(() => {
      // Host IPC already gone or observation-frame ack timed out; hide is best-effort after turn/end.
    })
  })

  ctx.tools.register(defineTool({
    name: 'click',
    description:
      'Click at a 0–1000 position on the attached frontmost-window screenshot, then return the post-action screenshot. '
      + 'Use left (default) or right button; count 2 is a double-click. '
      + 'Optional modifiers (shift, cmd, option, control) are held only for this click.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: '0 for the attached frontmost-window screenshot.' },
      position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] as a 0–1000 fraction of that screenshot, not pixels.',
      },
      button: {
        type: 'string',
        enum: ['left', 'right'],
        default: 'left',
        description: 'Mouse button. Default: left.',
      },
      count: {
        type: 'integer',
        enum: [1, 2],
        default: 1,
        description: '1 for a single click, 2 for a double-click. Default: 1.',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Modifier keys held only for this click, for example ["shift"] or ["cmd"]. Omit for a plain click.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screenIndex: { type: 'integer', required: true },
          position: { type: 'array', required: true, items: { type: 'number' } },
          button: { type: 'string', required: true, enum: ['left', 'right'] },
          count: { type: 'integer', required: true },
          modifiers: { type: 'array', items: { type: 'string' } },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        clickResultText(value),
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Click', {
      screen_index: args.screen_index,
      position: args.position,
      ...args.modifiers !== undefined && args.modifiers.length > 0 ? { modifiers: args.modifiers } : {},
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = validatedPosition(exec, args.position)
      const button: ClickButton = args.button === 'right' ? 'right' : 'left'
      const count: 1 | 2 = args.count === 2 ? 2 : 1
      const modifiers = requireClickModifiers(args.modifiers)
      return guiTurn(backend, exec.signal, async () => {
        const screens = await backend.listScreens(exec.signal)
        const screen = requireScreen(screens, args.screen_index)
        await backend.click({
          screen,
          position: hidPosition(exec, position),
          button,
          count,
          ...modifiers === undefined ? {} : { modifiers },
        }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          screenIndex: args.screen_index,
          position,
          button,
          count,
          ...modifiers === undefined ? {} : { modifiers },
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'input_text',
    description:
      'Click to focus a 0–1000 position on the attached frontmost-window screenshot, type text, optionally replace existing content and press Enter, then return the post-action screenshot.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: '0 for the attached frontmost-window screenshot.' },
      position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] as a 0–1000 fraction of that screenshot, not pixels; the click focuses the field.',
      },
      text: { type: 'string', required: true, description: 'Characters to type after the focus click.' },
      replace: {
        type: 'boolean',
        default: false,
        description: 'When true, select all in the focused field before typing. Default: false.',
      },
      submit: {
        type: 'boolean',
        default: false,
        description: 'When true, press Enter after typing. Default: false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screenIndex: { type: 'integer', required: true },
          position: { type: 'array', required: true, items: { type: 'number' } },
          text: { type: 'string', required: true },
          replace: { type: 'boolean', required: true },
          submit: { type: 'boolean', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Typed on screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (replace=${String(value.replace)}, submit=${String(value.submit)}). ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Type text', { screen_index: args.screen_index, text: args.text }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = validatedPosition(exec, args.position)
      const replace = args.replace ?? false
      const submit = args.submit ?? false
      return guiTurn(backend, exec.signal, async () => {
        const screens = await backend.listScreens(exec.signal)
        const screen = requireScreen(screens, args.screen_index)
        await backend.typeText({
          screen,
          position: hidPosition(exec, position),
          text: args.text,
          replace,
          submit,
        }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          screenIndex: args.screen_index,
          position,
          text: args.text,
          replace,
          submit,
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'scroll',
    description:
      'Scroll up or down at a 0–1000 position on the attached frontmost-window screenshot, then return the post-action screenshot. scroll_level is 1–10.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: '0 for the attached frontmost-window screenshot.' },
      position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] as a 0–1000 fraction of that screenshot, not pixels.',
      },
      direction: {
        type: 'string',
        required: true,
        enum: ['up', 'down'],
        description: 'Scroll direction.',
      },
      scroll_level: {
        type: 'integer',
        required: true,
        description: 'Scroll magnitude from 1 (smallest) to 10 (largest).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screenIndex: { type: 'integer', required: true },
          position: { type: 'array', required: true, items: { type: 'number' } },
          direction: { type: 'string', required: true, enum: ['up', 'down'] },
          scrollLevel: { type: 'integer', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Scrolled ${value.direction} on screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (level ${String(value.scrollLevel)}). ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Scroll', {
      screen_index: args.screen_index,
      direction: args.direction,
      scroll_level: args.scroll_level,
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = validatedPosition(exec, args.position)
      if (!Number.isInteger(args.scroll_level) || args.scroll_level < 1 || args.scroll_level > 10) {
        throw new Error('scroll_level must be an integer from 1 to 10')
      }
      return guiTurn(backend, exec.signal, async () => {
        const screens = await backend.listScreens(exec.signal)
        const screen = requireScreen(screens, args.screen_index)
        await backend.scroll({
          screen,
          position: hidPosition(exec, position),
          direction: args.direction,
          scrollLevel: args.scroll_level,
        }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          screenIndex: args.screen_index,
          position,
          direction: args.direction,
          scrollLevel: args.scroll_level,
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hotkey',
    description:
      'Press a key combination on the desktop, then return the post-action screenshot. '
      + 'System screenshot shortcuts (Cmd/Win+Shift+3/4/5) are rejected.',
    parameters: {
      keys: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Key names in order, for example ["cmd", "c"].',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keys: { type: 'array', required: true, items: { type: 'string' } },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Pressed hotkey [${value.keys.join(', ')}]. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Hotkey', args.keys),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      if (args.keys.length === 0) throw new Error('keys must contain at least one key')
      assertAllowedHotkey(args.keys)
      return guiTurn(backend, exec.signal, async () => {
        await backend.hotkey({ keys: args.keys }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          keys: args.keys,
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wait',
    description:
      'Pause 1 second, then return a fresh frontmost-window screenshot without moving the pointer. '
      + 'Use for page refresh, a loader, or a control that has not appeared yet. '
      + 'Do not use for code_agent.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          waitSeconds: { type: 'number', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Waited ${String(value.waitSeconds)}s. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: () => genericExecute('Wait', WAIT_SECONDS),
    async execute(_args, exec) {
      await assertImageCapableRoute(ctx, exec)
      await delay(WAIT_SECONDS * 1000, exec.signal)
      const observation = await recapture(ctx, backend, exec)
      return {
        waitSeconds: WAIT_SECONDS,
        ...observedFields(sessionOf(exec), observation),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'long_wait',
    description:
      'Pause 10, 30, 60, or 120 seconds, then return a fresh frontmost-window screenshot without moving the pointer. '
      + 'Only for a visible long job such as a download, installer, export, or on-screen generation. '
      + 'Pick the smallest wait_seconds that covers remaining progress; 120 only when the screenshot already shows a minutes-long job. '
      + 'Ordinary loading uses wait. Do not use for code_agent.',
    parameters: {
      wait_seconds: {
        type: 'integer',
        required: true,
        enum: [...LONG_WAIT_SECONDS],
        description: 'Seconds to pause. Must be 10, 30, 60, or 120.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          waitSeconds: { type: 'number', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Waited ${String(value.waitSeconds)}s. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Long wait', args.wait_seconds),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const waitSeconds = requireLongWaitSeconds(args.wait_seconds)
      await delay(waitSeconds * 1000, exec.signal)
      const observation = await recapture(ctx, backend, exec)
      return {
        waitSeconds,
        ...observedFields(sessionOf(exec), observation),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'screenshot',
    description:
      'Save the current frontmost-window screenshot to the user Desktop and copy it to the clipboard. '
      + 'Returns the saved file path. After bash, search, or web_fetch, call this to refresh the frontmost window. '
      + 'After click, type, wait, or open, do not call it again — those results already attach a window. '
      + 'Use when the user asked for a screenshot file or needs the image on the clipboard to paste.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: { type: 'array', required: true, items: { type: 'string' } },
          clipboard: { type: 'boolean', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        screenshotIntro(value.paths, value),
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: () => genericExecute('Screenshot', {}),
    async execute(_args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const session = sessionOf(exec)
      const observation = await observeDesktop(ctx, backend, exec.signal, {
        coordinateMode: coordinateModeOf(session),
        persistCapture: captured => isUsableObservationRaster(captured.data),
      })
      const foreground = compactForeground(observation.foreground)
      if (observation.screens.length === 0) {
        if (observation.captures.length > 0) {
          throw new Error(
            `computer-use: screenshot capture was unusable. Retry screenshot, wait, or open_app.\n${formatForegroundEnvelope(foreground)}`,
          )
        }
        throw new Error('computer-use: screenshot produced no files')
      }
      rememberObservation(session, observation.screens)
      const files = pairScreenshotFiles(observation.captures, observation.screens)
      const paths = await writeDesktopScreenshots(files, { home: homedir() })
      const first = files[0]
      const firstPath = paths[0]
      if (first === undefined || firstPath === undefined) {
        throw new Error('computer-use: screenshot produced no files')
      }
      await backend.copyImageToClipboard(
        { path: firstPath, mediaType: first.mediaType },
        exec.signal,
      )
      return {
        paths: [...paths],
        clipboard: true,
        ...observedFields(session, { screens: [...observation.screens], foreground }),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'long_press',
    description:
      'Press and hold the left button at a 0–1000 position on the attached frontmost-window screenshot, then return the post-action screenshot. '
      + 'duration_seconds defaults to 3 and must be 1–10.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: '0 for the attached frontmost-window screenshot.' },
      position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] as a 0–1000 fraction of that screenshot, not pixels.',
      },
      duration_seconds: {
        type: 'number',
        default: 3,
        description: 'Hold duration in seconds. Default: 3. Must be 1–10.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screenIndex: { type: 'integer', required: true },
          position: { type: 'array', required: true, items: { type: 'number' } },
          durationSeconds: { type: 'number', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Long-pressed screen ${String(value.screenIndex)} at [${value.position.join(', ')}] for ${String(value.durationSeconds)}s. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Long press', {
      screen_index: args.screen_index,
      position: args.position,
      duration_seconds: args.duration_seconds ?? 3,
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = validatedPosition(exec, args.position)
      const durationSeconds = requireLongPressDuration(args.duration_seconds)
      return guiTurn(backend, exec.signal, async () => {
        const screens = await backend.listScreens(exec.signal)
        const screen = requireScreen(screens, args.screen_index)
        await backend.longPress({
          screen,
          position: hidPosition(exec, position),
          durationSeconds,
        }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          screenIndex: args.screen_index,
          position,
          durationSeconds,
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'drag',
    description:
      'Drag from a start 0–1000 position to an end 0–1000 position on the attached frontmost-window screenshot, then return the post-action screenshot.',
    parameters: {
      start_screen_index: {
        type: 'integer',
        required: true,
        description: '0 for the attached frontmost-window screenshot.',
      },
      start_position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] start as a 0–1000 fraction of that screenshot, not pixels.',
      },
      end_screen_index: {
        type: 'integer',
        required: true,
        description: '0 for the attached frontmost-window screenshot.',
      },
      end_position: {
        type: 'array',
        required: true,
        items: { type: 'number' },
        description: '[x, y] end as a 0–1000 fraction of that screenshot, not pixels.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startScreenIndex: { type: 'integer', required: true },
          startPosition: { type: 'array', required: true, items: { type: 'number' } },
          endScreenIndex: { type: 'integer', required: true },
          endPosition: { type: 'array', required: true, items: { type: 'number' } },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Dragged from screen ${String(value.startScreenIndex)} [${value.startPosition.join(', ')}] `
        + `to screen ${String(value.endScreenIndex)} [${value.endPosition.join(', ')}]. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Drag', {
      start_screen_index: args.start_screen_index,
      end_screen_index: args.end_screen_index,
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const startPosition = validatedPosition(exec, args.start_position)
      const endPosition = validatedPosition(exec, args.end_position)
      return guiTurn(backend, exec.signal, async () => {
        const screens = await backend.listScreens(exec.signal)
        const startScreen = requireScreen(screens, args.start_screen_index)
        const endScreen = requireScreen(screens, args.end_screen_index)
        await backend.drag({
          startScreen,
          startPosition: hidPosition(exec, startPosition),
          endScreen,
          endPosition: hidPosition(exec, endPosition),
        }, exec.signal)
        const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
        return {
          startScreenIndex: args.start_screen_index,
          startPosition,
          endScreenIndex: args.end_screen_index,
          endPosition,
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'open_in_browser',
    description:
      'Open the default browser, or a full http(s) URL in it, then return the post-action screenshot. '
      + 'This is the user-visible browser. Do not use web_fetch as a substitute. '
      + 'Chinese in path or query must be plain text, never CJK percent-encoding such as %E5... / %E8....',
    parameters: {
      url: {
        type: 'string',
        description: 'http(s) URL to open. Omit to launch the default browser with no page.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        value.url === undefined
          ? `Opened the default browser. ${coordinatesRemain(value)}`
          : `Opened ${value.url} in the default browser. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Open in browser', args.url === undefined ? {} : { url: args.url }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const url = args.url === undefined || args.url.trim() === '' ? undefined : requireBrowserUrl(args.url)
      await backend.openInBrowser(url === undefined ? {} : { url }, exec.signal)
      const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
      return {
        ...url === undefined ? {} : { url },
        ...observedFields(sessionOf(exec), observation),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'open_in_finder',
    description:
      'Open a folder in Finder, open a file with its default app, or reveal a file in Finder, then return the post-action screenshot. '
      + 'Omit path to open the Desktop. Use reveal_only only to select a file in Finder (Open With or rename/move). '
      + 'Pass a real path; do not OCR one from the screenshot.',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute or ~ path. Omit to open the user Desktop.',
      },
      reveal_only: {
        type: 'boolean',
        default: false,
        description: 'When true and path is a file, reveal it in Finder instead of opening it. Default: false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          revealOnly: { type: 'boolean', required: true },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        value.revealOnly
          ? `Revealed ${value.path} in Finder. ${coordinatesRemain(value)}`
          : `Opened ${value.path}. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Open in Finder', {
      ...args.path === undefined ? {} : { path: args.path },
      reveal_only: args.reveal_only ?? false,
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const requestedReveal = args.reveal_only ?? false
      const target = await resolveFinderOpen(args.path, requestedReveal)
      const info = await stat(target.path)
      const revealOnly = target.revealOnly && info.isFile()
      await backend.openInFinder({ path: target.path, revealOnly }, exec.signal)
      const observation = await recapture(ctx, backend, exec, config.postActionWaitMs)
      return {
        path: target.path,
        revealOnly,
        ...observedFields(sessionOf(exec), observation),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_apps',
    description:
      'List running regular (Dock-visible) applications by display name, then return the current frontmost-window screenshot. '
      + 'Use this when the attached window is the wrong app.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apps: { type: 'array', required: true, items: { type: 'string' } },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        value.apps.length === 0
          ? `No running regular applications. ${coordinatesRemain(value)}`
          : `Running apps: ${value.apps.join(', ')}. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: () => genericExecute('List apps', {}),
    async execute(_args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const apps = await backend.listApps(exec.signal)
      const observation = await recapture(ctx, backend, exec)
      return {
        apps: [...apps],
        ...observedFields(sessionOf(exec), observation),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'open_app',
    description:
      'Activate a running application or launch it by display name or bundle id, then return the post-action screenshot. '
      + 'Use this when the attached window is the wrong app. Do not click the Dock.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Localized application name or bundle identifier, for example Pages or com.apple.TextEdit.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          action: { type: 'string', enum: ['activated', 'launched'] },
          error: { type: 'string' },
          ...COORDINATE_FIELDS,
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        value.ok
          ? `Opened ${value.name} (${value.action ?? 'activated'}). ${coordinatesRemain(value)}`
          : `Could not open ${value.name}: ${value.error ?? 'unknown error'}. ${coordinatesRemain(value)}`,
        value.screens,
        value.foreground,
        value,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Open app', { name: args.name }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const name = args.name.trim()
      if (name === '') throw new Error('name must be a non-empty application name or bundle id')
      return guiTurn(backend, exec.signal, async () => {
        let action: 'activated' | 'launched' | undefined
        let error: string | undefined
        let settleMs = 0
        try {
          const result = await backend.openApp({ name }, exec.signal)
          action = result.kind
          settleMs = config.postActionWaitMs
        } catch (caught: unknown) {
          if (exec.signal.aborted || (caught instanceof Error && caught.name === 'AbortError')) throw caught
          error = caught instanceof Error ? caught.message : String(caught)
        }
        const observation = await recapture(ctx, backend, exec, settleMs)
        return {
          name,
          ok: error === undefined,
          ...action === undefined ? {} : { action },
          ...error === undefined ? {} : { error },
          ...observedFields(sessionOf(exec), observation),
        }
      })
    },
  }))

  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || decision.messages.length === 0) return decision
    if (isDesktopSelectionTurn(messages)) return decision
    if (!messages.some(message => message.source.kind === 'user')) return decision
    if (!await routeAcceptsImages(ctx, agent, signal)) return decision
    signal.throwIfAborted()
    const mode = coordinateModeOf(agent.session)
    const observation = await observeDesktop(ctx, backend, signal, { coordinateMode: mode })
    rememberObservation(agent.session, observation.screens)
    signal.throwIfAborted()
    const notice = createUserMessage({
      content: [
        {
          type: 'text',
          text: firstFrameNotice(mode),
        },
        ...observation.blocks,
      ],
      source: {
        kind: 'plugin',
        plugin: PLUGIN_NAME,
        form: 'notice',
        summary: 'Frontmost window attached',
      },
    })
    return { ...decision, messages: [...decision.messages, notice] }
  })
}
