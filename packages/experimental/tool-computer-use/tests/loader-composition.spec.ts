import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ComputerUse from '../src/index.ts'
import * as fakeComputerUse from './fixtures/fake-computer-use.ts'
import * as PresetRoot from '../src/preset-root.ts'
import { PRESET_ROOT } from '../src/preset-root.ts'

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
    throw new Error('computer-use composition tests never stream')
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('computer-use-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id,
    options: { provider: 'visual', model: 'vision-model' },
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

describe('computer-use real Loader composition', () => {
  it('loads a fake-desktop fixture then Computer Use and logs image blocks on click', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-cu-loader-'))
    const fixture = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, fixture.replace("'{{dshHome}}'", JSON.stringify(root)))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
      ['./fake-computer-use.ts', fakeComputerUse],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
    ]))

    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'click', 'drag', 'hotkey', 'input_text', 'long_press', 'long_wait',
      'open_in_browser', 'open_in_finder', 'scroll', 'wait',
    ])
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-click'),
      name: 'click',
      arguments: { screen_index: 0, position: [50, 50] },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'image')).toBe(true)
    expect(result.content.some(block => block.type === 'text' && 'text' in block && block.text.includes('<path>'))).toBe(false)
  }, 30_000)

  it('production apply remains a named plugin export for Loader', () => {
    expect(ComputerUse.name).toBe('tool-computer-use')
    expect(ComputerUse.inject).toContain('attachments')
    expect('default' in ComputerUse).toBe(false)
  })
})

describe('computer-use overlay inject interpolation', () => {
  // A raw Context can read the provided path; Loader !!js cannot until the row injects it.
  it('interpolates ctx.computerUsePresetRoot after agent-presets injects it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-cu-preset-root-'))
    const fixture = await readFile(new URL('./fixtures/preset-root-overlay.yml', import.meta.url), 'utf8')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, fixture)

    let resolved: string | undefined
    const RootConsumer = {
      name: 'root-consumer',
      apply(_ctx: Context, config: { path: string }) {
        resolved = config.path
      },
    }

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['./preset-root.ts', PresetRoot],
      ['./root-consumer.ts', RootConsumer],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(resolved).toBe(PRESET_ROOT)
  })
})
