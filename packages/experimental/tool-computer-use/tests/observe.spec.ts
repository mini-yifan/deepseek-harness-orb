import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { FOCUS_FALLBACK_FOREGROUND } from '../src/backend.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import {
  formatForegroundEnvelope,
  imageRefFromObserved,
  observeDesktop,
  requireScreen,
} from '../src/observe.ts'
import * as waitModule from '../src/wait.ts'

const SIGNAL = new AbortController().signal

let home: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await context?.fiber.dispose()
  context = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

describe('observeDesktop', () => {
  it('captures one frontmost-window screenshot and omits filesystem paths', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const backend = createFakeDesktopBackend({
      screens: [
        { index: 0, bounds: { x: 12, y: 34, width: 100, height: 80 }, scale: 1, windowId: 9 },
      ],
      foreground: { appName: 'Pages', windowTitle: 'Untitled' },
    })
    const observation = await observeDesktop(ctx, backend, SIGNAL)
    expect(observation.screens).toHaveLength(1)
    expect(observation.captures).toHaveLength(1)
    expect(observation.captures[0]?.mediaType).toBe('image/png')
    expect(observation.screens[0]?.screenIndex).toBe(0)
    expect(observation.blocks.some(block => block.type === 'image')).toBe(true)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<frontmost_app>Pages</frontmost_app>'),
    )).toBe(true)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<frontmost_window>Untitled</frontmost_window>'),
    )).toBe(true)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<path>'),
    )).toBe(false)
    const image = observation.screens[0]?.image
    expect(image).toBeDefined()
    expect(imageRefFromObserved(image!).attachmentId).toBe(image!.attachmentId)
    expect(imageRefFromObserved({
      attachmentId: 'sha256:plain',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    })).toEqual({
      attachmentId: 'sha256:plain',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    })
    expect(imageRefFromObserved({
      attachmentId: 'sha256:named',
      mediaType: 'image/png',
      bytes: 2,
      width: 2,
      height: 2,
      name: 'desktop-screen-0',
      originalDimensions: { width: 4, height: 4 },
    })).toMatchObject({
      name: 'desktop-screen-0',
      originalDimensions: { width: 4, height: 4 },
    })
  })

  it('waits settleMs after inspect and before capture', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-settle-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const order: string[] = []
    const delay = vi.spyOn(waitModule, 'delay').mockImplementation(async () => {
      order.push('delay')
    })
    const fake = createFakeDesktopBackend({
      screens: [
        { index: 0, bounds: { x: 0, y: 0, width: 100, height: 80 }, scale: 1, windowId: 9 },
      ],
    })
    const observation = await observeDesktop(ctx, {
      ...fake,
      inspectForeground: async () => {
        order.push('inspect')
        return fake.inspectForeground()
      },
      capture: async (screen, signal) => {
        order.push('capture')
        return fake.capture(screen, signal)
      },
    }, SIGNAL, { settleMs: 600 })
    expect(observation.screens).toHaveLength(1)
    expect(delay).toHaveBeenCalledWith(600, SIGNAL)
    expect(order).toEqual(['inspect', 'delay', 'capture'])
  })

  it('returns focus tags without a panorama when no window remains', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-empty-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const empty = createFakeDesktopBackend({
      screens: [],
      foreground: FOCUS_FALLBACK_FOREGROUND,
    })
    const delay = vi.spyOn(waitModule, 'delay')
    const observation = await observeDesktop(
      ctx,
      empty,
      SIGNAL,
      { settleMs: 600 },
    )
    expect(delay).not.toHaveBeenCalled()
    expect(observation.screens).toEqual([])
    expect(observation.captures).toEqual([])
    expect(observation.blocks.some(block => block.type === 'image')).toBe(false)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<frontmost_app>none</frontmost_app>'),
    )).toBe(true)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<focus_note>'),
    )).toBe(true)
    const abort = new AbortController()
    abort.abort(new Error('stopped'))
    await expect(observeDesktop(
      ctx,
      createFakeDesktopBackend(),
      abort.signal,
    )).rejects.toThrow('stopped')
  })

  it('uses fallback when inspectForeground throws', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-fg-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const fake = createFakeDesktopBackend()
    const observation = await observeDesktop(
      ctx,
      {
        ...fake,
        inspectForeground: () => Promise.reject(new Error('ax failed')),
      },
      SIGNAL,
    )
    expect(observation.foreground).toEqual(FOCUS_FALLBACK_FOREGROUND)
    expect(observation.blocks.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<focus_note>'),
    )).toBe(true)
  })

  it('rethrows abort from inspectForeground', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-abort-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const fake = createFakeDesktopBackend()
    const abort = new Error('stopped')
    abort.name = 'AbortError'
    await expect(observeDesktop(
      ctx,
      {
        ...fake,
        inspectForeground: () => Promise.reject(abort),
      },
      SIGNAL,
    )).rejects.toThrow('stopped')

    const controller = new AbortController()
    await expect(observeDesktop(
      ctx,
      {
        ...fake,
        inspectForeground: () => {
          controller.abort(new Error('stopped'))
          return Promise.reject(new Error('ax failed'))
        },
      },
      controller.signal,
    )).rejects.toThrow('ax failed')
  })
})

describe('formatForegroundEnvelope', () => {
  it('omits empty folder and note tags', () => {
    expect(formatForegroundEnvelope({ appName: 'Pages', windowTitle: 'Untitled' })).toBe(
      '<frontmost_app>Pages</frontmost_app>\n<frontmost_window>Untitled</frontmost_window>',
    )
    expect(formatForegroundEnvelope({ appName: 'Pages' })).toBe(
      '<frontmost_app>Pages</frontmost_app>',
    )
    expect(formatForegroundEnvelope({
      appName: 'Finder',
      finderFolder: '/Users/test/Documents',
    })).toBe(
      '<frontmost_app>Finder</frontmost_app>\n<frontmost_folder>/Users/test/Documents</frontmost_folder>',
    )
    expect(formatForegroundEnvelope(FOCUS_FALLBACK_FOREGROUND)).toContain('<frontmost_app>none</frontmost_app>')
    expect(formatForegroundEnvelope(FOCUS_FALLBACK_FOREGROUND)).toContain('<focus_note>')
    expect(formatForegroundEnvelope({ appName: 'Finder', finderFolder: '  ' }))
      .toBe('<frontmost_app>Finder</frontmost_app>')
    expect(formatForegroundEnvelope({ appName: '  ' })).toBe(
      '<frontmost_app>none</frontmost_app>',
    )
    expect(formatForegroundEnvelope({ appName: 'none', focusNote: '  ' })).toBe(
      '<frontmost_app>none</frontmost_app>',
    )
  })
})

describe('requireScreen', () => {
  it('names the available index range', () => {
    expect(() => requireScreen([], 0)).toThrow(/out of range \(none\)/u)
    expect(() => requireScreen([
      { index: 2, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
    ], 0)).toThrow(/out of range \(0\.\.2\)/u)
  })
})
