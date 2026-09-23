import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { FOCUS_FALLBACK_FOREGROUND, type DesktopForeground, type ScreenInfo } from '../src/backend.ts'
import { resolveComputerUseConfig } from '../src/config.ts'
import { createFakeDesktopBackend, FAKE_WINDOW_PNG } from '../src/fake.ts'
import { applyComputerUse } from '../src/plugin.ts'
import { apply, Config, inject, name } from '../src/index.ts'
import * as ComputerUse from '../src/index.ts'
import { POLICY, policyFor } from '../src/policy.ts'
import { formatScreenEnvelope } from '../src/observe.ts'
import { UNSUPPORTED_DESKTOP_MESSAGE } from '../src/unsupported.ts'
import * as waitModule from '../src/wait.ts'
import * as screenshotModule from '../src/screenshot.ts'
import type {} from '../src/coordinate-mode.ts'

const SIGNAL = new AbortController().signal

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
    throw new Error('computer-use tool tests never stream')
  }
}

function agentOn(model: string | undefined, provider = 'visual', session?: Session): object {
  return {
    options: model === undefined ? {} : { provider, model },
    session: session ?? {
      requestHeader: () => (model === undefined ? undefined : { config: { provider, model } }),
    },
  }
}

let call = 0
function execute(ctx: Context, tool: string, args: unknown, model = 'vision-model', session?: Session) {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: ToolCallId(`cu-${++call}`),
    name: tool,
    arguments: args,
    agent: agentOn(model, 'visual', session) as never,
  })
}

function promptAgent(session: Session): Agent {
  return {
    id: session.id,
    session,
    options: { provider: 'visual', model: 'vision-model' },
  } as Agent
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

beforeEach(() => {
  vi.spyOn(waitModule, 'delay').mockResolvedValue(undefined)
})

async function setup(options: {
  attachments?: boolean
  llm?: boolean
  model?: LlmModelInfo
  foreground?: DesktopForeground
  screens?: readonly ScreenInfo[]
  apps?: readonly string[]
  postActionWaitMs?: number
  png?: Uint8Array
} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cu-'))
  homes.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  }
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter([
      options.model ?? { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
      { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
      { provider: 'visual', id: 'plain-model', name: 'Plain' },
    ]))
  }
  const backend = createFakeDesktopBackend({
    ...options.foreground === undefined ? {} : { foreground: options.foreground },
    ...options.screens === undefined ? {} : { screens: options.screens },
    ...options.apps === undefined ? {} : { apps: options.apps },
    ...options.png === undefined ? {} : { png: options.png },
  })
  applyComputerUse(ctx, backend, resolveComputerUseConfig({
    postActionWaitMs: options.postActionWaitMs ?? 0,
  }))
  return { ctx, backend }
}

describe('plugin metadata', () => {
  it('exports loader identity without a default export', () => {
    expect(name).toBe('tool-computer-use')
    expect(inject).toEqual(['tools', 'systemPrompt', 'attachments'])
    expect(Config({}).postActionWaitMs).toBe(600)
    expect(resolveComputerUseConfig({}).postActionWaitMs).toBe(600)
    expect(() => resolveComputerUseConfig({ postActionWaitMs: -1 })).toThrow(/postActionWaitMs/u)
    expect('default' in ComputerUse).toBe(false)
  })
})

describe('computer-use tools', () => {
  it('records a click and returns image blocks without a filesystem path', async () => {
    const { ctx, backend } = await setup()
    const result = await execute(ctx, 'click', { screen_index: 0, position: [100, 200] })
    expect(result.isError).toBe(false)
    expect(backend.actions).toHaveLength(1)
    expect(backend.actions[0]).toMatchObject({
      type: 'click',
      input: {
        position: [100, 200],
        button: 'left',
        count: 1,
      },
    })
    const body = text(result)
    expect(body).not.toContain('<path>')
    expect(body).toContain('<frontmost_app>Pages</frontmost_app>')
    expect(body).toContain('<screen_index>0</screen_index>')
    expect(body).toContain('<coordinate_space>0-1000</coordinate_space>')
    expect(body).not.toContain('<logical_size>')
    expect(body).not.toContain('<attached_size>')
    expect(body).not.toContain('downscaled')
    expect(body).not.toContain('multiply')
    expect(result.content.some(block => block.type === 'image')).toBe(true)
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode'), name: 'click', arguments: { screen_index: 0, position: [0, 0] },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-input'), name: 'input_text',
      arguments: { screen_index: 0, position: [0, 0], text: 'x' },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-scroll'), name: 'scroll',
      arguments: { screen_index: 0, position: [0, 0], direction: 'down', scroll_level: 1 },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-hotkey'), name: 'hotkey',
      arguments: { keys: ['c'] },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-wait'), name: 'wait', arguments: {},
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-long-wait'), name: 'long_wait', arguments: { wait_seconds: 10 },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-screenshot'), name: 'screenshot', arguments: {},
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-long-press'), name: 'long_press',
      arguments: { screen_index: 0, position: [0, 0] },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-drag'), name: 'drag',
      arguments: {
        start_screen_index: 0, start_position: [0, 0],
        end_screen_index: 0, end_position: [1, 1],
      },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-browser'), name: 'open_in_browser', arguments: {},
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-finder'), name: 'open_in_finder', arguments: {},
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-list-apps'), name: 'list_apps', arguments: {},
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({
      signal: SIGNAL, callId: ToolCallId('mode-open-app'), name: 'open_app', arguments: { name: 'Pages' },
    })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.get('click')?.presentCall?.({
      screen_index: 0, position: [0, 0],
    })).toMatchObject({ card: 'generic', kind: 'execute', title: 'Click' })
  })

  it('holds click modifiers only for that click', async () => {
    const { ctx, backend } = await setup()
    const result = await execute(ctx, 'click', {
      screen_index: 0, position: [100, 200], modifiers: ['cmd', 'shift'],
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('modifiers cmd, shift')
    expect(backend.actions[0]).toMatchObject({
      type: 'click',
      input: {
        position: [100, 200],
        button: 'left',
        count: 1,
        modifiers: ['cmd', 'shift'],
      },
    })
    const empty = await execute(ctx, 'click', {
      screen_index: 0, position: [1, 1], modifiers: [],
    })
    expect(empty.isError).toBe(false)
    expect(text(empty)).not.toContain('modifiers')
    const emptyClick = backend.actions[1]
    expect(emptyClick?.type).toBe('click')
    if (emptyClick?.type === 'click') {
      expect(emptyClick.input.modifiers).toBeUndefined()
    }
    expect(ctx.tools.get('click')?.presentCall?.({
      screen_index: 0, position: [0, 0], modifiers: ['shift'],
    })).toMatchObject({
      card: 'generic',
      title: 'Click',
      rawInput: { screen_index: 0, position: [0, 0], modifiers: ['shift'] },
    })
  })

  it('rejects non-modifier click keys before HID', async () => {
    const { ctx, backend } = await setup()
    const letter = await execute(ctx, 'click', {
      screen_index: 0, position: [0, 0], modifiers: ['a'],
    })
    expect(letter.isError).toBe(true)
    expect(text(letter)).toContain('click modifiers must be shift, cmd, option, or control')
    const fnKey = await execute(ctx, 'click', {
      screen_index: 0, position: [0, 0], modifiers: ['fn'],
    })
    expect(fnKey.isError).toBe(true)
    expect(backend.actions).toHaveLength(0)
  })

  it('types, scrolls, hotkeys, and waits through the fake backend', async () => {
    const { ctx, backend } = await setup()
    const typed = await execute(ctx, 'input_text', {
      screen_index: 0, position: [10, 10], text: 'hello', replace: true, submit: true,
    })
    expect(typed.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'typeText',
      input: { text: 'hello', replace: true, submit: true },
    })
    const scrolled = await execute(ctx, 'scroll', {
      screen_index: 0, position: [0, 0], direction: 'up', scroll_level: 3,
    })
    expect(scrolled.isError).toBe(false)
    const hotkey = await execute(ctx, 'hotkey', { keys: ['cmd', 'c'] })
    expect(hotkey.isError).toBe(false)
    const waited = await execute(ctx, 'wait', {})
    expect(waited.isError).toBe(false)
    expect(text(waited)).toContain('Waited 1s')
    expect(waitModule.delay).toHaveBeenCalledWith(1000, SIGNAL)
    const extra = await execute(ctx, 'wait', { wait_seconds: 5 })
    expect(extra.isError).toBe(false)
    expect(text(extra)).toContain('Waited 1s')
    const right = await execute(ctx, 'click', { screen_index: 0, position: [1, 1], button: 'right', count: 2 })
    expect(right.isError).toBe(false)
    expect(backend.actions.some(action => action.type === 'click' && action.input.button === 'right' && action.input.count === 2)).toBe(true)
    expect(ctx.tools.get('input_text')?.presentCall?.({
      screen_index: 0, position: [0, 0], text: 'x',
    })).toMatchObject({ card: 'generic', title: 'Type text' })
    expect(ctx.tools.get('wait')?.presentCall?.({})).toMatchObject({ card: 'generic', title: 'Wait' })
    const typedDefaults = await execute(ctx, 'input_text', {
      screen_index: 0, position: [0, 0], text: 'plain',
    })
    expect(typedDefaults.isError).toBe(false)
    expect(backend.actions.some(action =>
      action.type === 'typeText' && !action.input.replace && !action.input.submit,
    )).toBe(true)
    expect(ctx.tools.get('scroll')?.presentCall?.({
      screen_index: 0, position: [0, 0], direction: 'down', scroll_level: 1,
    })).toMatchObject({ card: 'generic', title: 'Scroll' })
    expect(ctx.tools.get('hotkey')?.presentCall?.({ keys: ['c'] }))
      .toMatchObject({ card: 'generic', title: 'Hotkey' })
    expect(ctx.tools.get('wait')?.presentCall?.({}))
      .toMatchObject({ card: 'generic', title: 'Wait' })
  })

  it('settles postActionWaitMs before recapture inspect', async () => {
    const { ctx, backend } = await setup({ postActionWaitMs: 600 })
    const result = await execute(ctx, 'click', { screen_index: 0, position: [100, 200] })
    expect(result.isError).toBe(false)
    expect(backend.actions[0]).toMatchObject({ type: 'click' })
    expect(waitModule.delay).toHaveBeenCalledWith(600, SIGNAL)
    await execute(ctx, 'scroll', {
      screen_index: 0, position: [0, 0], direction: 'down', scroll_level: 1,
    })
    expect(waitModule.delay).toHaveBeenCalledWith(600, SIGNAL)
  })

  it('holds withGuiTurn across HID and recapture; wait and screenshot skip it', async () => {
    const { ctx, backend } = await setup()
    let turns = 0
    const inner = backend.withGuiTurn.bind(backend)
    backend.withGuiTurn = async (run, signal) => {
      turns += 1
      return inner(run, signal)
    }
    await execute(ctx, 'click', { screen_index: 0, position: [100, 200] })
    expect(turns).toBe(1)
    turns = 0
    await execute(ctx, 'wait', {})
    expect(turns).toBe(0)
    await execute(ctx, 'long_wait', { wait_seconds: 10 })
    expect(turns).toBe(0)
    await execute(ctx, 'screenshot', {})
    expect(turns).toBe(0)
    await execute(ctx, 'list_apps', {})
    expect(turns).toBe(0)
    await execute(ctx, 'open_app', { name: 'Pages' })
    expect(turns).toBe(1)
  })

  it('saves a desktop screenshot and copies it to the clipboard', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-shot-home-'))
    homes.push(home)
    const originalWrite = screenshotModule.writeDesktopScreenshots
    const write = vi.spyOn(screenshotModule, 'writeDesktopScreenshots').mockImplementation(
      (files, options) => originalWrite(files, {
        ...options,
        home,
        now: new Date(2026, 8, 15, 20, 10, 0),
      }),
    )
    try {
      const { ctx, backend } = await setup({ png: FAKE_WINDOW_PNG })
      const result = await execute(ctx, 'screenshot', {})
      expect(result.isError).toBe(false)
      const saved = join(home, 'Desktop', 'Screenshot 2026-09-15 at 20.10.00.png')
      expect(text(result)).toContain(`Saved screenshot to ${saved}`)
      expect(text(result)).toContain('copied it to the clipboard')
      expect(backend.actions.at(-1)).toMatchObject({
        type: 'copyImageToClipboard',
        input: { path: saved, mediaType: 'image/png' },
      })
      expect(ctx.tools.get('screenshot')?.presentCall?.({}))
        .toMatchObject({ card: 'generic', title: 'Screenshot' })
      const textRoute = await execute(ctx, 'screenshot', {}, 'text-model')
      expect(textRoute.isError).toBe(true)
      expect(text(textRoute)).toContain('does not declare image input')
    } finally {
      write.mockRestore()
    }
  })

  it('skips Desktop, clipboard, and image blocks when the capture is smaller than 2×2', async () => {
    const write = vi.spyOn(screenshotModule, 'writeDesktopScreenshots')
    try {
      const { ctx, backend } = await setup()
      const result = await execute(ctx, 'screenshot', {})
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('screenshot capture was unusable')
      expect(text(result)).toContain('Retry screenshot, wait, or open_app')
      expect(text(result)).toContain('<frontmost_app>Pages</frontmost_app>')
      expect(result.content.some(block => block.type === 'image')).toBe(false)
      expect(write).not.toHaveBeenCalled()
      expect(backend.actions.some(action => action.type === 'copyImageToClipboard')).toBe(false)
    } finally {
      write.mockRestore()
    }
  })

  it('lists apps and activates or reports open_app failure without a desktop panorama', async () => {
    const { ctx, backend } = await setup()
    const listed = await execute(ctx, 'list_apps', {})
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('Running apps: Pages, Safari')
    expect(text(listed)).toContain('<frontmost_app>Pages</frontmost_app>')
    expect(text(listed)).toContain('<screen_index>0</screen_index>')
    expect(ctx.tools.get('list_apps')?.presentCall?.({})).toMatchObject({
      card: 'generic', title: 'List apps',
    })
    const opened = await execute(ctx, 'open_app', { name: 'Safari' })
    expect(opened.isError).toBe(false)
    expect(text(opened)).toContain('Opened Safari (activated)')
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'openApp',
      input: { name: 'Safari' },
    })
    expect(ctx.tools.get('open_app')?.presentCall?.({ name: 'Safari' }))
      .toMatchObject({ card: 'generic', title: 'Open app' })
    const blank = await execute(ctx, 'open_app', { name: '   ' })
    expect(blank.isError).toBe(true)
    expect(text(blank)).toContain('non-empty')
    const failingHome = await mkdtemp(join(tmpdir(), 'dsh-cu-open-fail-'))
    homes.push(failingHome)
    const failingCtx = new Context()
    contexts.push(failingCtx)
    await failingCtx.plugin(SystemPrompt)
    await failingCtx.plugin(ToolRuntime)
    await failingCtx.plugin(LocalAttachmentStore, { dshHome: failingHome })
    await failingCtx.plugin(LlmRuntime)
    failingCtx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    applyComputerUse(failingCtx, createFakeDesktopBackend({
      screens: [],
      foreground: FOCUS_FALLBACK_FOREGROUND,
      openAppError: new Error('computer-use: app name "Paint" matches multiple applications: Paint, Paintbrush'),
    }), resolveComputerUseConfig({ postActionWaitMs: 0 }))
    const failed = await execute(failingCtx, 'open_app', { name: 'Paint' })
    expect(failed.isError).toBe(false)
    expect(text(failed)).toContain('Could not open Paint')
    expect(text(failed)).toContain('matches multiple applications')
    expect(text(failed)).toContain('<frontmost_app>none</frontmost_app>')
    expect(text(failed)).toContain('<focus_note>')
    expect(failed.content.some(block => block.type === 'image')).toBe(false)
  })

  it('renders empty app lists and open_app fallbacks; rethrows open_app abort', async () => {
    const { ctx } = await setup({ apps: [] })
    const listed = await execute(ctx, 'list_apps', {})
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('No running regular applications')
    const open = ctx.tools.get('open_app')
    expect(open).toBeDefined()
    expect(text({
      content: open!.output.render({}, {
        name: 'Pages',
        ok: true,
        screens: [],
        foreground: { appName: 'Pages' },
      }),
    })).toContain('(activated)')
    expect(text({
      content: open!.output.render({}, {
        name: 'Pages',
        ok: false,
        screens: [],
        foreground: { appName: 'Pages' },
      }),
    })).toContain('unknown error')

    const abortHome = await mkdtemp(join(tmpdir(), 'dsh-cu-open-abort-'))
    homes.push(abortHome)
    const abortCtx = new Context()
    contexts.push(abortCtx)
    await abortCtx.plugin(SystemPrompt)
    await abortCtx.plugin(ToolRuntime)
    await abortCtx.plugin(LocalAttachmentStore, { dshHome: abortHome })
    await abortCtx.plugin(LlmRuntime)
    abortCtx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    const abort = new Error('stopped')
    abort.name = 'AbortError'
    applyComputerUse(abortCtx, createFakeDesktopBackend({ openAppError: abort }), resolveComputerUseConfig({
      postActionWaitMs: 0,
    }))
    const aborted = await execute(abortCtx, 'open_app', { name: 'Pages' })
    expect(aborted.isError).toBe(true)

    const stringHome = await mkdtemp(join(tmpdir(), 'dsh-cu-open-string-'))
    homes.push(stringHome)
    const stringCtx = new Context()
    contexts.push(stringCtx)
    await stringCtx.plugin(SystemPrompt)
    await stringCtx.plugin(ToolRuntime)
    await stringCtx.plugin(LocalAttachmentStore, { dshHome: stringHome })
    await stringCtx.plugin(LlmRuntime)
    stringCtx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    const fake = createFakeDesktopBackend()
    applyComputerUse(stringCtx, {
      ...fake,
      openApp: async () => {
        throw 'boom'
      },
    }, resolveComputerUseConfig({ postActionWaitMs: 0 }))
    const stringFail = await execute(stringCtx, 'open_app', { name: 'Pages' })
    expect(stringFail.isError).toBe(false)
    expect(text(stringFail)).toContain('Could not open Pages: boom')
  })

  it('fails loud when screenshot writing returns no paths', async () => {
    const write = vi.spyOn(screenshotModule, 'writeDesktopScreenshots').mockResolvedValue([])
    try {
      const { ctx } = await setup({ png: FAKE_WINDOW_PNG })
      const result = await execute(ctx, 'screenshot', {})
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('produced no files')
    } finally {
      write.mockRestore()
    }
  })

  it('fails loud when screenshot has no window to capture', async () => {
    const write = vi.spyOn(screenshotModule, 'writeDesktopScreenshots')
    try {
      const { ctx, backend } = await setup({
        screens: [],
        foreground: FOCUS_FALLBACK_FOREGROUND,
      })
      const result = await execute(ctx, 'screenshot', {})
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('produced no files')
      expect(result.content.some(block => block.type === 'image')).toBe(false)
      expect(write).not.toHaveBeenCalled()
      expect(backend.actions.some(action => action.type === 'copyImageToClipboard')).toBe(false)
    } finally {
      write.mockRestore()
    }
  })

  it('long-waits only the 10/30/60/120 buckets', async () => {
    const { ctx } = await setup()
    for (const seconds of [10, 30, 60, 120] as const) {
      vi.mocked(waitModule.delay).mockClear()
      const result = await execute(ctx, 'long_wait', { wait_seconds: seconds })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain(`Waited ${String(seconds)}s`)
      expect(waitModule.delay).toHaveBeenCalledWith(seconds * 1000, SIGNAL)
    }
    expect(ctx.tools.get('long_wait')?.presentCall?.({ wait_seconds: 60 }))
      .toMatchObject({ card: 'generic', title: 'Long wait' })
  })

  it('long-presses, drags, and opens through the fake backend', async () => {
    const { ctx, backend } = await setup()
    const home = await mkdtemp(join(homedir(), 'dsh-cu-finder-'))
    homes.push(home)
    const file = join(home, 'report.pdf')
    await writeFile(file, 'x')
    const resolvedFile = await realpath(file)
    const resolvedHome = await realpath(home)
    const pressed = await execute(ctx, 'long_press', { screen_index: 0, position: [10, 20] })
    expect(pressed.isError).toBe(false)
    expect(text(pressed)).toContain('Long-pressed screen 0 at [10, 20] for 3s')
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'longPress',
      input: { position: [10, 20], durationSeconds: 3 },
    })
    const held = await execute(ctx, 'long_press', {
      screen_index: 0, position: [0, 0], duration_seconds: 2,
    })
    expect(held.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'longPress',
      input: { durationSeconds: 2 },
    })
    const dragged = await execute(ctx, 'drag', {
      start_screen_index: 0, start_position: [0, 0],
      end_screen_index: 0, end_position: [500, 500],
    })
    expect(dragged.isError).toBe(false)
    expect(text(dragged)).toContain('Dragged from screen 0 [0, 0] to screen 0 [500, 500]')
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'drag',
      input: { startPosition: [0, 0], endPosition: [500, 500] },
    })
    const browser = await execute(ctx, 'open_in_browser', { url: 'www.bilibili.com' })
    expect(browser.isError).toBe(false)
    expect(text(browser)).toContain('Opened https://www.bilibili.com in the default browser')
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'openInBrowser',
      input: { url: 'https://www.bilibili.com' },
    })
    const launched = await execute(ctx, 'open_in_browser', {})
    expect(launched.isError).toBe(false)
    expect(text(launched)).toContain('Opened the default browser')
    expect(backend.actions.at(-1)).toMatchObject({ type: 'openInBrowser', input: {} })
    const blankUrl = await execute(ctx, 'open_in_browser', { url: '   ' })
    expect(blankUrl.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({ type: 'openInBrowser', input: {} })
    const opened = await execute(ctx, 'open_in_finder', { path: file })
    expect(opened.isError).toBe(false)
    expect(text(opened)).toContain(`Opened ${resolvedFile}`)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'openInFinder',
      input: { path: resolvedFile, revealOnly: false },
    })
    const revealed = await execute(ctx, 'open_in_finder', { path: file, reveal_only: true })
    expect(revealed.isError).toBe(false)
    expect(text(revealed)).toContain(`Revealed ${resolvedFile} in Finder`)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'openInFinder',
      input: { revealOnly: true },
    })
    const folderReveal = await execute(ctx, 'open_in_finder', { path: home, reveal_only: true })
    expect(folderReveal.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'openInFinder',
      input: { path: resolvedHome, revealOnly: false },
    })
    expect(ctx.tools.get('long_press')?.presentCall?.({
      screen_index: 0, position: [0, 0],
    })).toMatchObject({ card: 'generic', title: 'Long press' })
    expect(ctx.tools.get('drag')?.presentCall?.({
      start_screen_index: 0, start_position: [0, 0],
      end_screen_index: 0, end_position: [1, 1],
    })).toMatchObject({ card: 'generic', title: 'Drag' })
    expect(ctx.tools.get('open_in_browser')?.presentCall?.({}))
      .toMatchObject({ card: 'generic', title: 'Open in browser' })
    expect(ctx.tools.get('open_in_browser')?.presentCall?.({ url: 'https://example.com' }))
      .toMatchObject({ card: 'generic', title: 'Open in browser' })
    expect(ctx.tools.get('open_in_finder')?.presentCall?.({}))
      .toMatchObject({ card: 'generic', title: 'Open in Finder' })
    expect(ctx.tools.get('open_in_finder')?.presentCall?.({ path: file }))
      .toMatchObject({ card: 'generic', title: 'Open in Finder' })
  })

  it('rejects screenshot hotkeys, bad positions, and text-only routes', async () => {
    const { ctx } = await setup()
    const shot = await execute(ctx, 'hotkey', { keys: ['cmd', 'shift', '3'] })
    expect(shot.isError).toBe(true)
    expect(text(shot)).toContain('screenshot shortcuts are forbidden')
    const position = await execute(ctx, 'click', { screen_index: 0, position: [0] })
    expect(position.isError).toBe(true)
    const missing = await execute(ctx, 'click', { screen_index: 9, position: [0, 0] })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('out of range')
    const scroll = await execute(ctx, 'scroll', {
      screen_index: 0, position: [0, 0], direction: 'down', scroll_level: 11,
    })
    expect(scroll.isError).toBe(true)
    const textRoute = await execute(ctx, 'click', { screen_index: 0, position: [0, 0] }, 'text-model')
    expect(textRoute.isError).toBe(true)
    expect(text(textRoute)).toContain('does not declare image input')
    const plain = await execute(ctx, 'click', { screen_index: 0, position: [0, 0] }, 'plain-model')
    expect(plain.isError).toBe(true)
    expect(text(plain)).toContain('does not declare image input')
    const empty = await execute(ctx, 'hotkey', { keys: [] })
    expect(empty.isError).toBe(true)
    const omitted = await execute(ctx, 'long_wait', {})
    expect(omitted.isError).toBe(true)
    expect(text(omitted)).toMatch(/wait_seconds/u)
    for (const seconds of [1, 5, 9, 20, 25]) {
      const invalid = await execute(ctx, 'long_wait', { wait_seconds: seconds })
      expect(invalid.isError).toBe(true)
    }
    const textLongWait = await execute(ctx, 'long_wait', { wait_seconds: 10 }, 'text-model')
    expect(textLongWait.isError).toBe(true)
    expect(text(textLongWait)).toContain('does not declare image input')
    const duration = await execute(ctx, 'long_press', {
      screen_index: 0, position: [0, 0], duration_seconds: 11,
    })
    expect(duration.isError).toBe(true)
    expect(text(duration)).toContain('1 to 10')
    const cjk = await execute(ctx, 'open_in_browser', { url: 'https://example.com/%E5%88%98' })
    expect(cjk.isError).toBe(true)
    expect(text(cjk)).toContain('plain CJK')
    const ftp = await execute(ctx, 'open_in_browser', { url: 'ftp://example.com' })
    expect(ftp.isError).toBe(true)
    const forbidden = await execute(ctx, 'open_in_finder', { path: '/etc' })
    expect(forbidden.isError).toBe(true)
    expect(text(forbidden)).toContain('system path is forbidden')
    const missingPath = await execute(ctx, 'open_in_finder', { path: '/no/such/computer-use-path' })
    expect(missingPath.isError).toBe(true)
    expect(text(missingPath)).toContain('does not exist')
    const textLongPress = await execute(ctx, 'long_press', { screen_index: 0, position: [0, 0] }, 'text-model')
    expect(textLongPress.isError).toBe(true)
    expect(text(textLongPress)).toContain('does not declare image input')
    const missingLlm = await setup({ llm: false })
    const noLlm = await execute(missingLlm.ctx, 'click', { screen_index: 0, position: [0, 0] })
    expect(noLlm.isError).toBe(true)
    expect(text(noLlm)).toContain('could not be resolved')
    const unresolved = await ctx.tools.execute({
      signal: SIGNAL,
      callId: ToolCallId('cu-unresolved'),
      name: 'click',
      arguments: { screen_index: 0, position: [0, 0] },
    })
    expect(unresolved.isError).toBe(true)
    expect(text(unresolved)).toContain('could not be resolved')
  })

  it('registers the Computer Use policy section', async () => {
    const { ctx } = await setup()
    const assembled = await ctx.systemPrompt.assemble()
    expect(assembled.sections.some(section => section.text === POLICY)).toBe(true)
    expect(POLICY).toContain('trust only the attached screenshot of the frontmost application on this display')
    expect(POLICY).toContain("includes that app's open menus, popovers, and panels")
    expect(POLICY).toContain('except where they overlap this app\'s windows')
    expect(POLICY).toContain('Do not click the Dock')
    expect(POLICY).toContain('call list_apps or open_app')
    expect(POLICY).toContain('Encode x and y as fractions of this screenshot × 1000 (center x is 500, not a pixel x)')
    expect(POLICY).toContain('Do not send raw pixel coordinates')
    expect(POLICY).toContain('Ignore pixel widths and any other image-handle dimensions')
    expect(POLICY).not.toContain('downscale')
    expect(POLICY).not.toContain('multiply')
    expect(POLICY).toContain('you may emit several GUI tool calls in one step')
    expect(POLICY).toContain('The host runs those calls in order')
    expect(POLICY).toContain('Each result includes its own post-action screenshot')
    expect(POLICY).toContain('Do not batch a click, type, or hotkey')
    expect(POLICY).not.toContain('exactly one GUI action')
    expect(POLICY).toContain('call open_in_finder with that path')
    expect(POLICY).toContain('Open a site in the user\'s visible browser with open_in_browser')
    expect(POLICY).toContain('Do not use bash open as a substitute')
    expect(POLICY).toContain('Drag sliders, window edges, and files with drag')
    expect(POLICY).toContain('Press and hold with long_press')
    expect(POLICY).toContain('Multi-select with click plus shift or cmd on each later click')
    expect(POLICY).toContain('do not hold a modifier across calls')
    expect(POLICY).toContain('call wait')
    expect(POLICY).toContain('call long_wait with the smallest of 10, 30, 60, or 120')
    expect(POLICY).toContain('Do not use long_wait for ordinary page load')
    expect(POLICY).toContain('After bash, search, or web_fetch, screenshot may refresh the frontmost window')
    expect(POLICY).toContain('After click, type, wait, or open, do not call screenshot again')
    expect(POLICY).toContain('Call screenshot when the user asked for a screenshot file')
    expect(POLICY).toContain('Do not call wait, long_wait, or bash sleep')
    expect(POLICY).toContain('today\'s weather')
    expect(POLICY).toContain('code_agent_status')
    expect(POLICY).toContain('code_agent_stop')
    expect(POLICY).toContain(
      'When a user message starts with "Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent."',
    )
    expect(POLICY).toContain('Do not call GUI tools, code_agent, or screenshot on that turn')
    for (const schema of ctx.tools.schemas()) {
      expect(schema.description, schema.name).not.toContain('Exclusive')
      expect(schema.description, schema.name).not.toContain('do not combine')
    }
  })

  it('unregisters tools and the policy on fiber disposal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-hmr-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const computerUse = Object.assign(
      function computerUse(scope: Context) {
        applyComputerUse(scope, createFakeDesktopBackend(), resolveComputerUseConfig({ postActionWaitMs: 0 }))
      },
      { inject: ['tools', 'systemPrompt', 'attachments'] },
    )
    const fiber = await ctx.plugin(computerUse)
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'click', 'drag', 'hotkey', 'input_text', 'list_apps', 'long_press', 'long_wait',
      'open_app', 'open_in_browser', 'open_in_finder', 'screenshot', 'scroll', 'wait',
    ])
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('code_agent')
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('stays pending until attachments exist', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ComputerUse)
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('apply registers tools that fail at execute on an unsupported platform', async () => {
    const host = new Context()
    contexts.push(host)
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-host-'))
    homes.push(home)
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    await host.plugin(LocalAttachmentStore, { dshHome: home })
    await host.plugin(LlmRuntime)
    host.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))
    apply(host, { postActionWaitMs: 0 })
    expect(host.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'click', 'drag', 'hotkey', 'input_text', 'list_apps', 'long_press', 'long_wait',
      'open_app', 'open_in_browser', 'open_in_finder', 'screenshot', 'scroll', 'wait',
    ])
    expect(host.tools.schemas().map(schema => schema.name)).not.toContain('code_agent')
    if (process.platform === 'darwin' || process.platform === 'win32') return
    const result = await host.tools.execute({
      signal: SIGNAL,
      callId: ToolCallId('host-click'),
      name: 'click',
      arguments: { screen_index: 0, position: [0, 0] },
      agent: agentOn('vision-model') as never,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(UNSUPPORTED_DESKTOP_MESSAGE)
  })
})

describe('screen envelopes', () => {
  it('names only screen index and the 0–1000 space, even when saveImage reduced the raster', () => {
    const envelope = formatScreenEnvelope({
      screenIndex: 1,
      logicalWidth: 1440,
      logicalHeight: 900,
      scale: 2,
      image: {
        attachmentId: 'sha256:x',
        mediaType: 'image/png',
        bytes: 12,
        width: 720,
        height: 450,
        originalDimensions: { width: 1440, height: 900 },
      },
    })
    expect(envelope).toBe(
      '<screen_index>1</screen_index>\n<coordinate_space>0-1000</coordinate_space>',
    )
    expect(envelope).not.toContain('<logical_size>')
    expect(envelope).not.toContain('<attached_size>')
    expect(envelope).not.toContain('downscaled')
    expect(envelope).not.toContain('multiply')
    expect(envelope).not.toContain('px')
    expect(envelope).not.toContain('<path>')
  })

  it('omits pixel sizes when the attached raster is unchanged', () => {
    const envelope = formatScreenEnvelope({
      screenIndex: 0,
      logicalWidth: 1000,
      logicalHeight: 800,
      scale: 1,
      image: {
        attachmentId: 'sha256:z',
        mediaType: 'image/png',
        bytes: 4,
        width: 1000,
        height: 800,
      },
    })
    expect(envelope).toBe(
      '<screen_index>0</screen_index>\n<coordinate_space>0-1000</coordinate_space>',
    )
    expect(envelope).not.toContain('<path>')
  })

  it('names attached WxH only in pixel mode', () => {
    const screen = {
      screenIndex: 1,
      logicalWidth: 1440,
      logicalHeight: 900,
      scale: 2,
      image: {
        attachmentId: 'sha256:x',
        mediaType: 'image/png' as const,
        bytes: 12,
        width: 720,
        height: 450,
        originalDimensions: { width: 1440, height: 900 },
      },
    }
    expect(formatScreenEnvelope(screen, 'pixel')).toBe(
      '<screen_index>1</screen_index>\n<coordinate_space>pixels</coordinate_space>\n<attached_size>720x450</attached_size>',
    )
    expect(formatScreenEnvelope(screen, 'millifraction')).not.toContain('<attached_size>')
  })

  it('names Finder folder and focus fallback on GUI results', async () => {
    const { ctx: finderCtx } = await setup({
      foreground: { appName: 'Finder', finderFolder: '/Users/test/Documents' },
    })
    const finder = await execute(finderCtx, 'click', { screen_index: 0, position: [0, 0] })
    expect(text(finder)).toContain('<frontmost_folder>/Users/test/Documents</frontmost_folder>')
    expect(text(finder)).not.toContain('<path>')

    const { ctx: fallbackCtx } = await setup({ foreground: FOCUS_FALLBACK_FOREGROUND })
    const fallback = await execute(fallbackCtx, 'wait', {})
    expect(text(fallback)).toContain('<frontmost_app>none</frontmost_app>')
    expect(text(fallback)).toContain('<focus_note>')
  })

  it('maps click coordinates through current window bounds', async () => {
    const { ctx, backend } = await setup({
      screens: [{ index: 0, bounds: { x: 100, y: 200, width: 400, height: 300 }, scale: 2, windowId: 8 }],
    })
    const result = await execute(ctx, 'click', { screen_index: 0, position: [0, 0] })
    expect(result.isError).toBe(false)
    expect(backend.actions[0]).toMatchObject({
      type: 'click',
      input: {
        screen: { bounds: { x: 100, y: 200, width: 400, height: 300 } },
        position: [0, 0],
      },
    })
  })
})

describe('computer-use session coordinate modes', () => {
  it('assembles millifraction and pixel POLICY and position copy for two sessions in one process', async () => {
    const { ctx } = await setup()
    const milli = Session.create(SessionId('cu-milli-assemble'))
    const pixel = Session.create(SessionId('cu-pixel-assemble'))
    pixel.append('computer-use/coordinate-mode', { mode: 'pixel' })
    const milliAssembly = await ctx.systemPrompt.assemble(assembleContextFor(promptAgent(milli)))
    const pixelAssembly = await ctx.systemPrompt.assemble(assembleContextFor(promptAgent(pixel)))
    expect(milliAssembly.sections.find(section => section.name === 'tool:computer-use')?.text).toBe(POLICY)
    expect(pixelAssembly.sections.find(section => section.name === 'tool:computer-use')?.text)
      .toBe(policyFor('pixel'))
    expect(policyFor('pixel')).toContain('pixel columns and rows')
    expect(policyFor('pixel')).toContain('Do not send 0–1000 fractions')
    expect(policyFor('pixel')).not.toContain('center x is 500')
    const milliClick = milliAssembly.tools.find(tool => tool.name === 'click')
    const pixelClick = pixelAssembly.tools.find(tool => tool.name === 'click')
    const pixelDrag = pixelAssembly.tools.find(tool => tool.name === 'drag')
    expect(JSON.stringify(milliClick)).toContain('0–1000 fraction of that screenshot, not pixels')
    expect(milliClick?.description).not.toContain('Exclusive')
    expect(milliClick?.description).not.toContain('do not combine')
    expect(milliClick?.description).toContain('Optional modifiers (shift, cmd, option, control) are held only for this click.')
    expect(JSON.stringify(pixelClick)).toContain('pixel columns and rows of the attached screenshot')
    expect(JSON.stringify(pixelClick)).not.toContain('0–1000 fraction of that screenshot, not pixels')
    expect(pixelClick?.description).not.toContain('Exclusive')
    expect(pixelClick?.description).not.toContain('do not combine')
    expect(pixelClick?.description).toContain('Optional modifiers (shift, cmd, option, control) are held only for this click.')
    expect(JSON.stringify(pixelDrag)).toContain('start as pixel columns')
    expect(JSON.stringify(pixelDrag)).toContain('end as pixel columns')
  })

  it('maps pixel clicks through attached raster size and keeps drag ends in the same encoding', async () => {
    const { ctx, backend } = await setup({
      screens: [{ index: 0, bounds: { x: 10, y: 20, width: 400, height: 200 }, scale: 1, windowId: 3 }],
    })
    const session = Session.create(SessionId('cu-pixel-click'))
    session.append('computer-use/coordinate-mode', { mode: 'pixel' })
    const missing = await execute(ctx, 'click', { screen_index: 0, position: [0, 0] }, 'vision-model', session)
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('attached screenshot raster')
    const waited = await execute(ctx, 'wait', {}, 'vision-model', session)
    expect(waited.isError).toBe(false)
    expect(text(waited)).toContain('<coordinate_space>pixels</coordinate_space>')
    expect(text(waited)).toContain('<attached_size>1x1</attached_size>')
    const result = await execute(ctx, 'click', { screen_index: 0, position: [1, 1] }, 'vision-model', session)
    expect(result.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'click',
      input: { position: [1000, 1000] },
    })
    expect(text(result)).toContain('Clicked screen 0 at [1, 1]')
    expect(text(result)).toContain('Coordinates remain pixels of the attached 1x1 screenshot.')
    const oob = await execute(ctx, 'click', { screen_index: 0, position: [2, 0] }, 'vision-model', session)
    expect(oob.isError).toBe(true)
    expect(text(oob)).toContain('1x1')
    const drag = await execute(ctx, 'drag', {
      start_screen_index: 0,
      start_position: [0, 0],
      end_screen_index: 0,
      end_position: [1, 1],
    }, 'vision-model', session)
    expect(drag.isError).toBe(false)
    expect(backend.actions.at(-1)).toMatchObject({
      type: 'drag',
      input: { startPosition: [0, 0], endPosition: [1000, 1000] },
    })
  })
})
