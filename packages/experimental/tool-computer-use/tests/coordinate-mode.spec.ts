import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { resolveComputerUseConfig } from '../src/config.ts'
import {
  coordinateModeOf,
  coordinateOutcome,
  coordinatesRemain,
  firstFrameNotice,
  lastAttachedRaster,
  loggedCoordinateMode,
  rememberObservation,
  stampCoordinateMode,
  toolsForCoordinateMode,
} from '../src/coordinate-mode.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import { applyComputerUse } from '../src/plugin.ts'

import type {} from '../src/coordinate-mode.ts'

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

function agentFor(session: Session): Agent {
  return {
    id: session.id,
    session,
    options: { provider: 'visual', model: 'vision' },
  } as Agent
}

describe('computer-use coordinate-mode stamp', () => {
  it('stamps a blank create from orbCoordinateMode and leaves resume and existing events alone', () => {
    const ctx = new Context()
    ctx.provide('orbCoordinateMode', { currentMode: () => 'pixel' as const })
    const fresh = Session.create(SessionId('cu-coord-fresh'))
    stampCoordinateMode(ctx, fresh)
    expect(loggedCoordinateMode(fresh)).toBe('pixel')
    expect(coordinateModeOf(fresh)).toBe('pixel')

    stampCoordinateMode(ctx, fresh)
    expect(fresh.snapshotEvents().filter(event => event.type === 'computer-use/coordinate-mode')).toHaveLength(1)

    const resumed = Session.create(SessionId('cu-coord-resume'), [])
    expect(resumed.snapshotEvents().some(event => event.type === 'session/end-seed')).toBe(true)
    stampCoordinateMode(ctx, resumed)
    expect(loggedCoordinateMode(resumed)).toBeUndefined()
    expect(coordinateModeOf(resumed)).toBe('millifraction')
  })

  it('does not write an event without orbCoordinateMode', () => {
    const ctx = new Context()
    const session = Session.create(SessionId('cu-coord-headless'))
    stampCoordinateMode(ctx, session)
    expect(loggedCoordinateMode(session)).toBeUndefined()
    expect(coordinateModeOf(undefined)).toBe('millifraction')
  })

  it('stamps from agent/created when the Desktop service is present', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-coord-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('orbCoordinateMode', { currentMode: () => 'pixel' as const })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({ postActionWaitMs: 0 }))
    const session = Session.create(SessionId('cu-coord-created'))
    ctx.emit('agent/created', { agent: agentFor(session) })
    expect(loggedCoordinateMode(session)).toBe('pixel')
  })
})

describe('computer-use observation raster cache', () => {
  it('remembers the attached raster and reconstructs it from a plugin notice', () => {
    const session = Session.create(SessionId('cu-coord-raster'))
    rememberObservation(session, [{ image: { width: 720, height: 450 } }])
    expect(lastAttachedRaster(session)).toEqual({ width: 720, height: 450 })
    rememberObservation(session, [])
    expect(lastAttachedRaster(session)).toBeUndefined()

    const restored = Session.create(SessionId('cu-coord-restore'))
    restored.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'notice' },
        {
          type: 'tool-result',
          toolCallId: ToolCallId('c1'),
          content: [{
            type: 'image',
            attachment: {
              attachmentId: AttachmentId('sha256:cu'),
              mediaType: 'image/png',
              bytes: 4,
              width: 640,
              height: 360,
            },
          }],
        },
      ],
      source: { kind: 'plugin', plugin: 'tool-computer-use', form: 'notice', summary: 'frontmost' },
    }), { surfaceOp: 'append' })
    expect(lastAttachedRaster(restored)).toEqual({ width: 640, height: 360 })
  })

  it('reconstructs from a GUI tool result and skips non-CU images', () => {
    rememberObservation(undefined, [{ image: { width: 10, height: 10 } }])
    expect(lastAttachedRaster(undefined)).toBeUndefined()
    expect(lastAttachedRaster({} as Session)).toBeUndefined()
    expect(lastAttachedRaster({
      snapshotEvents: () => [undefined],
    } as unknown as Session)).toBeUndefined()

    const userOnly = Session.create(SessionId('cu-coord-user-only'))
    userOnly.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:other'),
          mediaType: 'image/png',
          bytes: 4,
          width: 99,
          height: 99,
        },
      }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(lastAttachedRaster(userOnly)).toBeUndefined()

    const otherPlugin = Session.create(SessionId('cu-coord-other-plugin'))
    otherPlugin.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:other-plugin'),
          mediaType: 'image/png',
          bytes: 4,
          width: 50,
          height: 50,
        },
      }],
      source: { kind: 'plugin', plugin: 'other-plugin', form: 'notice', summary: 'other' },
    }), { surfaceOp: 'append' })
    expect(lastAttachedRaster(otherPlugin)).toBeUndefined()

    const emptyNotice = Session.create(SessionId('cu-coord-empty-notice'))
    emptyNotice.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'empty notice' },
        { type: 'image', attachment: { attachmentId: AttachmentId('sha256:zero'), mediaType: 'image/png', bytes: 1, width: 0, height: 0 } },
      ],
      source: { kind: 'plugin', plugin: 'tool-computer-use', form: 'notice', summary: 'empty' },
    }), { surfaceOp: 'append' })
    expect(lastAttachedRaster(emptyNotice)).toBeUndefined()

    const emptyResult = Session.create(SessionId('cu-coord-empty-result'))
    emptyResult.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('click-empty'),
        content: [{ type: 'text', text: 'clicked' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    expect(lastAttachedRaster(emptyResult)).toBeUndefined()

    const restored = Session.create(SessionId('cu-coord-tool-result'))
    restored.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('click-1'),
        content: [{
          type: 'image',
          attachment: {
            attachmentId: AttachmentId('sha256:gui'),
            mediaType: 'image/png',
            bytes: 8,
            width: 320,
            height: 180,
          },
        }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    expect(lastAttachedRaster(restored)).toEqual({ width: 320, height: 180 })
  })
})

describe('computer-use coordinate copy and schema rewrite', () => {
  it('names millifraction and pixel remain-copy, including pixel without attached size', () => {
    expect(coordinatesRemain({ coordinateMode: 'millifraction' })).toBe('Coordinates remain 0–1000.')
    expect(coordinatesRemain({ coordinateMode: 'pixel', attachedWidth: 640, attachedHeight: 360 }))
      .toBe('Coordinates remain pixels of the attached 640x360 screenshot.')
    expect(coordinatesRemain({ coordinateMode: 'pixel' }))
      .toBe('Coordinates remain pixels of the attached screenshot.')
    expect(firstFrameNotice('millifraction')).toContain('0–1000 fractions')
    expect(firstFrameNotice('pixel')).toContain('pixel columns and rows')
    expect(coordinateOutcome(undefined, [{ image: { width: 10, height: 10 } }])).toEqual({
      coordinateMode: 'millifraction',
    })
    const pixel = Session.create(SessionId('cu-coord-outcome-pixel'))
    pixel.append('computer-use/coordinate-mode', { mode: 'pixel' })
    expect(coordinateOutcome(pixel, [])).toEqual({ coordinateMode: 'pixel' })
    expect(coordinateOutcome(pixel, [{ image: { width: 10, height: 10 } }])).toEqual({
      coordinateMode: 'pixel',
      attachedWidth: 10,
      attachedHeight: 10,
    })
  })

  it('rewrites pixel position tools and leaves millifraction schemas copied', () => {
    const click: ToolSchema = {
      name: 'click',
      description: 'millifraction click',
      parameters: {
        type: 'object',
        properties: {
          position: { type: 'array', description: '0–1000' },
        },
      },
    }
    const skipField: ToolSchema = {
      name: 'click',
      description: 'millifraction click',
      parameters: {
        type: 'object',
        properties: { position: 'not-an-object' },
      },
    }
    const wait: ToolSchema = { name: 'wait', description: 'wait', parameters: { type: 'object' } }
    const noProperties: ToolSchema = {
      name: 'click',
      description: 'millifraction click',
      parameters: { type: 'object' },
    }
    const milliTools = [click, wait]
    const milli = toolsForCoordinateMode(milliTools, 'millifraction')
    expect(milli).toEqual(milliTools)
    expect(milli).not.toBe(milliTools)
    const pixel = toolsForCoordinateMode([click, wait, noProperties, skipField], 'pixel')
    expect(pixel[0]?.description).toContain('pixel position')
    expect((pixel[0]?.parameters as { properties: { position: { description: string } } }).properties.position.description)
      .toContain('pixel columns and rows')
    expect(pixel[1]).toEqual(wait)
    expect(pixel[2]?.description).toContain('pixel position')
  })
})

describe('computer-use coordinate-mode projection', () => {
  it('folds the last logged encoding', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-proj-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({ postActionWaitMs: 0 }))
    const session = Session.create(SessionId('cu-coord-proj'))
    expect(ctx.sessionProjections.stateOf(session, 'computerUseCoordinateMode')).toEqual({
      mode: 'millifraction',
    })
    session.append('computer-use/coordinate-mode', { mode: 'pixel' })
    expect(ctx.sessionProjections.stateOf(session, 'computerUseCoordinateMode')).toEqual({
      mode: 'pixel',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'later' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(ctx.sessionProjections.stateOf(session, 'computerUseCoordinateMode')).toEqual({
      mode: 'pixel',
    })
    session.append('computer-use/coordinate-mode', { mode: 'pixel' })
    expect(ctx.sessionProjections.stateOf(session, 'computerUseCoordinateMode')).toEqual({
      mode: 'pixel',
    })
  })

  it('registers the projection when session-projection mounts after Computer Use', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-proj-late-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({ postActionWaitMs: 0 }))
    await ctx.plugin(SessionProjectionRegistry)
    const session = Session.create(SessionId('cu-coord-late-proj'))
    session.append('computer-use/coordinate-mode', { mode: 'pixel' })
    expect(ctx.sessionProjections.stateOf(session, 'computerUseCoordinateMode')).toEqual({
      mode: 'pixel',
    })
  })
})
