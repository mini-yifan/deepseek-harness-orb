import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { resolveComputerUseConfig } from '../src/config.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import {
  imageRefFromObserved,
  observeDesktop,
  requireScreen,
} from '../src/observe.ts'

const SIGNAL = new AbortController().signal

let home: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

describe('observeDesktop', () => {
  it('captures at most maxScreens displays and omits filesystem paths', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const backend = createFakeDesktopBackend({
      screens: [
        { index: 0, bounds: { x: 0, y: 0, width: 100, height: 80 }, scale: 1 },
        { index: 1, bounds: { x: 100, y: 0, width: 50, height: 80 }, scale: 2 },
      ],
    })
    const observation = await observeDesktop(
      ctx,
      backend,
      resolveComputerUseConfig({ maxScreens: 1 }),
      SIGNAL,
    )
    expect(observation.screens).toHaveLength(1)
    expect(observation.screens[0]?.screenIndex).toBe(0)
    expect(observation.blocks.some(block => block.type === 'image')).toBe(true)
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

  it('rejects an empty display list and honors abort', async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cu-obs-empty-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const empty = createFakeDesktopBackend({ screens: [] })
    await expect(observeDesktop(
      ctx,
      empty,
      resolveComputerUseConfig({}),
      SIGNAL,
    )).rejects.toThrow(/no displays available/u)
    const abort = new AbortController()
    abort.abort(new Error('stopped'))
    await expect(observeDesktop(
      ctx,
      createFakeDesktopBackend(),
      resolveComputerUseConfig({}),
      abort.signal,
    )).rejects.toThrow('stopped')
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
