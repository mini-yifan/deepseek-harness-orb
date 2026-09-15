/**
 * Register Computer Use tools, policy, and first-frame screenshot attachment.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { ClickButton, DesktopBackend, DesktopForeground } from './backend.ts'
import type { ResolvedComputerUseConfig } from './config.ts'
import { assertAllowedHotkey, requireNormalizedPosition } from './coordinates.ts'
import {
  compactForeground,
  observationContent,
  observeDesktop,
  requireScreen,
  type ObservedScreen,
} from './observe.ts'
import { POLICY } from './policy.ts'
import { assertImageCapableRoute, routeAcceptsImages } from './route.ts'
import { delay } from './wait.ts'

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
    finderFolder: { type: 'string' },
    focusNote: { type: 'string' },
  },
} as const

function genericExecute(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'execute', rawInput }
}

function resultBlocks(
  intro: string,
  screens: readonly ObservedScreen[],
  foreground: DesktopForeground,
): ContentBlock[] {
  return [{ type: 'text', text: intro }, ...observationContent(screens, foreground)]
}

async function recapture(
  ctx: Context,
  backend: DesktopBackend,
  config: ResolvedComputerUseConfig,
  signal: AbortSignal,
): Promise<{ screens: ObservedScreen[]; foreground: DesktopForeground }> {
  const observation = await observeDesktop(ctx, backend, config, signal)
  return {
    screens: [...observation.screens],
    foreground: compactForeground(observation.foreground),
  }
}

/**
 * Register the five GUI tools, the policy section, and first-frame screenshot attachment.
 * @param ctx - registration scope; requires `tools`, `systemPrompt`, and `attachments`.
 * @param backend - desktop capture and input.
 * @param config - resolved tunables.
 */
export function applyComputerUse(
  ctx: Context,
  backend: DesktopBackend,
  config: ResolvedComputerUseConfig,
): void {
  ctx.systemPrompt.section({
    name: 'tool:computer-use',
    order: POLICY_SECTION_ORDER,
    text: POLICY,
  })

  ctx.tools.register(defineTool({
    name: 'click',
    description:
      'Click at a 0–1000 position on one desktop screen, then return the post-action screenshot. '
      + 'Use left (default) or right button; count 2 is a double-click. Exclusive: do not combine with other GUI tools in the same step.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: 'Zero-based display index from the latest screenshot envelope.' },
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
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Clicked screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (${value.button}, count ${String(value.count)}). Coordinates remain 0–1000.`,
        value.screens,
        value.foreground,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Click', {
      screen_index: args.screen_index,
      position: args.position,
    }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = requireNormalizedPosition(args.position)
      const button: ClickButton = args.button === 'right' ? 'right' : 'left'
      const count: 1 | 2 = args.count === 2 ? 2 : 1
      const screens = await backend.listScreens(exec.signal)
      const screen = requireScreen(screens, args.screen_index)
      await backend.click({ screen, position, button, count }, exec.signal)
      await delay(config.postActionWaitMs, exec.signal)
      const observation = await recapture(ctx, backend, config, exec.signal)
      return {
        screenIndex: args.screen_index,
        position,
        button,
        count,
        screens: observation.screens,
        foreground: observation.foreground,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'input_text',
    description:
      'Click to focus a 0–1000 position, type text, optionally replace existing content and press Enter, then return the post-action screenshot. Exclusive.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: 'Zero-based display index from the latest screenshot envelope.' },
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
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Typed on screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (replace=${String(value.replace)}, submit=${String(value.submit)}). Coordinates remain 0–1000.`,
        value.screens,
        value.foreground,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Type text', { screen_index: args.screen_index, text: args.text }),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const position = requireNormalizedPosition(args.position)
      const replace = args.replace ?? false
      const submit = args.submit ?? false
      const screens = await backend.listScreens(exec.signal)
      const screen = requireScreen(screens, args.screen_index)
      await backend.typeText({ screen, position, text: args.text, replace, submit }, exec.signal)
      await delay(config.postActionWaitMs, exec.signal)
      const observation = await recapture(ctx, backend, config, exec.signal)
      return {
        screenIndex: args.screen_index,
        position,
        text: args.text,
        replace,
        submit,
        screens: observation.screens,
        foreground: observation.foreground,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'scroll',
    description:
      'Scroll up or down at a 0–1000 position on one desktop screen, then return the post-action screenshot. scroll_level is 1–10. Exclusive.',
    parameters: {
      screen_index: { type: 'integer', required: true, description: 'Zero-based display index from the latest screenshot envelope.' },
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
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Scrolled ${value.direction} on screen ${String(value.screenIndex)} at [${value.position.join(', ')}] (level ${String(value.scrollLevel)}). Coordinates remain 0–1000.`,
        value.screens,
        value.foreground,
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
      const position = requireNormalizedPosition(args.position)
      if (!Number.isInteger(args.scroll_level) || args.scroll_level < 1 || args.scroll_level > 10) {
        throw new Error('scroll_level must be an integer from 1 to 10')
      }
      const screens = await backend.listScreens(exec.signal)
      const screen = requireScreen(screens, args.screen_index)
      await backend.scroll({
        screen,
        position,
        direction: args.direction,
        scrollLevel: args.scroll_level,
      }, exec.signal)
      await delay(config.postActionWaitMs, exec.signal)
      const observation = await recapture(ctx, backend, config, exec.signal)
      return {
        screenIndex: args.screen_index,
        position,
        direction: args.direction,
        scrollLevel: args.scroll_level,
        screens: observation.screens,
        foreground: observation.foreground,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hotkey',
    description:
      'Press a key combination on the desktop, then return the post-action screenshot. '
      + 'System screenshot shortcuts (Cmd/Win+Shift+3/4/5) are rejected. Exclusive.',
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
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Pressed hotkey [${value.keys.join(', ')}]. Coordinates remain 0–1000.`,
        value.screens,
        value.foreground,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Hotkey', args.keys),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      if (args.keys.length === 0) throw new Error('keys must contain at least one key')
      assertAllowedHotkey(args.keys)
      await backend.hotkey({ keys: args.keys }, exec.signal)
      await delay(config.postActionWaitMs, exec.signal)
      const observation = await recapture(ctx, backend, config, exec.signal)
      return {
        keys: args.keys,
        screens: observation.screens,
        foreground: observation.foreground,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wait',
    description:
      'Pause, then return a fresh desktop screenshot without moving the pointer. '
      + 'wait_seconds defaults to 1 and is clamped by the deployment maxWaitSeconds. Exclusive.',
    parameters: {
      wait_seconds: {
        type: 'number',
        description: 'Seconds to pause before recapturing. Default: 1, clamped by maxWaitSeconds.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          waitSeconds: { type: 'number', required: true },
          screens: SCREENS_FIELD,
          foreground: FOREGROUND_FIELD,
        },
      },
      render: (_args, value) => resultBlocks(
        `Waited ${String(value.waitSeconds)}s. Coordinates remain 0–1000.`,
        value.screens,
        value.foreground,
      ),
    },
    isConcurrencySafe: () => false,
    presentCall: args => genericExecute('Wait', args.wait_seconds ?? 1),
    async execute(args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const requested = args.wait_seconds ?? 1
      if (!Number.isFinite(requested) || requested < 0) {
        throw new Error('wait_seconds must be a finite number ≥ 0')
      }
      const waitSeconds = Math.min(requested, config.maxWaitSeconds)
      await delay(waitSeconds * 1000, exec.signal)
      const observation = await recapture(ctx, backend, config, exec.signal)
      return {
        waitSeconds,
        screens: observation.screens,
        foreground: observation.foreground,
      }
    },
  }))

  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || decision.messages.length === 0) return decision
    if (!messages.some(message => message.source.kind === 'user')) return decision
    if (!await routeAcceptsImages(ctx, agent, signal)) return decision
    signal.throwIfAborted()
    const observation = await observeDesktop(ctx, backend, config, signal)
    signal.throwIfAborted()
    const notice = createUserMessage({
      content: [
        {
          type: 'text',
          text: 'Current desktop screens. Coordinates use a 0–1000 space per screenshot ([0, 0] top-left, [1000, 1000] bottom-right of that image; not pixels).',
        },
        ...observation.blocks,
      ],
      source: {
        kind: 'plugin',
        plugin: PLUGIN_NAME,
        form: 'notice',
        summary: 'Desktop screens attached',
      },
    })
    return { ...decision, messages: [...decision.messages, notice] }
  })
}
