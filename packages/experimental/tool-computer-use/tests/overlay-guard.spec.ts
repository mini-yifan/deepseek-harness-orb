import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  LlmRuntime,
  ToolCallId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createFakeDesktopBackend } from '../src/fake.ts'
import { wrapDesktopBackend, type ComputerUseOverlayGuard } from '../src/overlay-guard.ts'
import { activeCaptureExcludeWindowIds } from '../src/capture-exclude.ts'
import type { DesktopBackend } from '../src/backend.ts'

const platformBackend = vi.hoisted(() => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  )
  const screen = { index: 0, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scale: 1 }
  return {
    listScreens: vi.fn(() => Promise.resolve([screen])),
    capture: vi.fn(() => Promise.resolve({ data: new Uint8Array(png), mediaType: 'image/png' as const })),
    inspectForeground: vi.fn(() => Promise.resolve({ appName: 'Pages' })),
    click: vi.fn(() => Promise.resolve()),
    typeText: vi.fn(() => Promise.resolve()),
    scroll: vi.fn(() => Promise.resolve()),
    hotkey: vi.fn(() => Promise.resolve()),
    longPress: vi.fn(() => Promise.resolve()),
    drag: vi.fn(() => Promise.resolve()),
    openInBrowser: vi.fn(() => Promise.resolve()),
    openInFinder: vi.fn(() => Promise.resolve()),
    copyImageToClipboard: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('../src/backend.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/backend.ts')>()
  return {
    ...actual,
    createPlatformBackend: () => platformBackend,
  }
})

const { apply } = await import('../src/index.ts')

const SIGNAL = new AbortController().signal
const screen = { index: 0, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scale: 1 }

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly models: LlmModelInfo[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const resolved = this.models.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: resolved?.name ?? model,
      ...resolved?.inputModalities === undefined ? {} : { inputModalities: [...resolved.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('computer-use overlay-guard tests never stream')
  }
}

function recordingGuard(): ComputerUseOverlayGuard & { readonly calls: readonly string[] } {
  const calls: string[] = []
  return {
    get calls() {
      return calls
    },
    async withCapture(run) {
      calls.push('capture')
      try {
        return await run({ excludeWindowIds: [] })
      } finally {
        calls.push('capture-end')
      }
    },
    async withInput(run) {
      calls.push('input')
      try {
        return await run()
      } finally {
        calls.push('input-end')
      }
    },
  }
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

function stubBackend(overrides: Partial<DesktopBackend> = {}): DesktopBackend {
  return {
    listScreens: () => Promise.resolve([screen]),
    capture: () => Promise.resolve({ data: new Uint8Array(), mediaType: 'image/png' as const }),
    inspectForeground: () => Promise.resolve({ appName: 'Pages' }),
    click: () => Promise.resolve(),
    typeText: () => Promise.resolve(),
    scroll: () => Promise.resolve(),
    hotkey: () => Promise.resolve(),
    longPress: () => Promise.resolve(),
    drag: () => Promise.resolve(),
    openInBrowser: () => Promise.resolve(),
    openInFinder: () => Promise.resolve(),
    copyImageToClipboard: () => Promise.resolve(),
    ...overrides,
  }
}

describe('wrapDesktopBackend', () => {
  it('cloaks capture, inspect, and HID but leaves listScreens and open unwrapped', async () => {
    const inner = createFakeDesktopBackend({ screens: [screen] })
    const guard = recordingGuard()
    const backend = wrapDesktopBackend(inner, guard)
    await backend.listScreens()
    await backend.capture(screen)
    await backend.inspectForeground()
    await backend.click({ screen, position: [1, 2], button: 'left', count: 1 })
    await backend.typeText({ screen, position: [1, 2], text: 'a', replace: false, submit: false })
    await backend.scroll({ screen, position: [1, 2], direction: 'down', scrollLevel: 1 })
    await backend.hotkey({ keys: ['c'] })
    await backend.longPress({ screen, position: [1, 2], durationSeconds: 3 })
    await backend.drag({
      startScreen: screen, startPosition: [0, 0],
      endScreen: screen, endPosition: [10, 10],
    })
    await backend.openInBrowser({ url: 'https://example.com' })
    await backend.openInFinder({ path: '/tmp', revealOnly: false })
    await backend.copyImageToClipboard({ path: '/tmp/shot.png', mediaType: 'image/png' })
    expect(guard.calls).toEqual([
      'capture', 'capture-end',
      'capture', 'capture-end',
      'input', 'input-end',
      'input', 'input-end',
      'input', 'input-end',
      'input', 'input-end',
      'input', 'input-end',
      'input', 'input-end',
    ])
    expect(inner.actions.map(action => action.type)).toEqual([
      'click', 'typeText', 'scroll', 'hotkey', 'longPress', 'drag', 'openInBrowser', 'openInFinder',
      'copyImageToClipboard',
    ])
  })

  it('forwards overlay window ids into the capture interval', async () => {
    const seen: (readonly number[])[] = []
    const inner = stubBackend({
      capture: () => {
        seen.push(activeCaptureExcludeWindowIds())
        return Promise.resolve({ data: new Uint8Array(), mediaType: 'image/png' as const })
      },
    })
    const backend = wrapDesktopBackend(inner, {
      withCapture: run => run({ excludeWindowIds: [11, 22] }),
      withInput: run => run(),
    })
    await backend.capture(screen)
    expect(seen).toEqual([[11, 22]])
    expect(activeCaptureExcludeWindowIds()).toEqual([])
  })

  it('forwards overlay window ids into inspectForeground', async () => {
    const seen: (readonly number[])[] = []
    const inner = stubBackend({
      inspectForeground: () => {
        seen.push(activeCaptureExcludeWindowIds())
        return Promise.resolve({ appName: 'Pages' })
      },
    })
    const backend = wrapDesktopBackend(inner, {
      withCapture: run => run({ excludeWindowIds: [11, 22] }),
      withInput: run => run(),
    })
    await expect(backend.inspectForeground()).resolves.toEqual({ appName: 'Pages' })
    expect(seen).toEqual([[11, 22]])
    expect(activeCaptureExcludeWindowIds()).toEqual([])
  })

  it('captures with no overlay ids when withCapture omits the session', async () => {
    const seen: (readonly number[])[] = []
    const inner = stubBackend({
      capture: () => {
        seen.push(activeCaptureExcludeWindowIds())
        return Promise.resolve({ data: new Uint8Array(), mediaType: 'image/png' as const })
      },
    })
    const backend = wrapDesktopBackend(inner, {
      withCapture: run => run(undefined as never),
      withInput: run => run(),
    })
    await backend.capture(screen)
    expect(seen).toEqual([[]])
  })

  it('restores the cloak when the inner call throws', async () => {
    const guard = recordingGuard()
    const backend = wrapDesktopBackend(stubBackend({
      capture: () => Promise.reject(new Error('shot failed')),
    }), guard)
    await expect(backend.capture(screen)).rejects.toThrow('shot failed')
    expect(guard.calls).toEqual(['capture', 'capture-end'])
  })
})

describe('apply overlay guard wiring', () => {
  const contexts: Context[] = []
  const homes: string[] = []

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
  })

  it('leaves the platform backend unwrapped when computerUseOverlayGuard is absent', async () => {
    const host = new Context()
    contexts.push(host)
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-unguarded-'))
    homes.push(home)
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    await host.plugin(LocalAttachmentStore, { dshHome: home })
    await host.plugin(LlmRuntime)
    host.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    apply(host, { postActionWaitMs: 0 })
    const result = await host.tools.execute({
      signal: SIGNAL,
      callId: ToolCallId('unguarded-click'),
      name: 'click',
      arguments: { screen_index: 0, position: [0, 0] },
      agent: {
        options: {},
        session: { requestHeader: () => ({ config: { provider: 'visual', model: 'vision-model' } }) },
      } as never,
    })
    expect(result.isError).toBe(false)
    expect(platformBackend.click).toHaveBeenCalled()
  })

  it('wraps the platform backend when computerUseOverlayGuard is present', async () => {
    const host = new Context()
    contexts.push(host)
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-guard-'))
    homes.push(home)
    host.provide('computerUseOverlayGuard', {
      withCapture: () => Promise.reject(new Error('cloaked-capture')),
      withInput: () => Promise.reject(new Error('cloaked-input')),
    })
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    await host.plugin(LocalAttachmentStore, { dshHome: home })
    await host.plugin(LlmRuntime)
    host.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    apply(host, { postActionWaitMs: 0 })
    const result = await host.tools.execute({
      signal: SIGNAL,
      callId: ToolCallId('guard-click'),
      name: 'click',
      arguments: { screen_index: 0, position: [0, 0] },
      agent: {
        options: {},
        session: { requestHeader: () => ({ config: { provider: 'visual', model: 'vision-model' } }) },
      } as never,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('cloaked-input')
  })

  it('wraps when computerUseOverlayGuard is provided on a parent context', async () => {
    const host = new Context()
    contexts.push(host)
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-guard-child-'))
    homes.push(home)
    host.provide('computerUseOverlayGuard', {
      withCapture: () => Promise.reject(new Error('cloaked-capture')),
      withInput: () => Promise.reject(new Error('cloaked-input')),
    })
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    await host.plugin(LocalAttachmentStore, { dshHome: home })
    await host.plugin(LlmRuntime)
    host.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    apply(host.extend(), { postActionWaitMs: 0 })
    const result = await host.tools.execute({
      signal: SIGNAL,
      callId: ToolCallId('guard-child-click'),
      name: 'click',
      arguments: { screen_index: 0, position: [0, 0] },
      agent: {
        options: {},
        session: { requestHeader: () => ({ config: { provider: 'visual', model: 'vision-model' } }) },
      } as never,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('cloaked-input')
  })
})
