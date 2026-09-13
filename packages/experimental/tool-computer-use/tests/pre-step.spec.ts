import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { resolveComputerUseConfig } from '../src/config.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import { applyComputerUse, PLUGIN_NAME } from '../src/plugin.ts'

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly image: boolean) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: this.image ? ['text', 'image'] : ['text'],
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('computer-use pre-step tests never stream')
  }
}

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

function agent(model: string): Agent {
  const session = Session.create(SessionId(`computer-use-pre-${model}`))
  return {
    id: session.id,
    session,
    options: { provider: 'visual', model },
  } as Agent
}

async function setup(image: boolean, withLlm = true) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cu-pre-'))
  homes.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  if (withLlm) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter(image))
  }
  applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({ postActionWaitMs: 0 }))
  return ctx
}

const user = createUserMessage({
  content: [{ type: 'text', text: 'look' }],
  source: { kind: 'user' },
})

describe('computer-use first-frame pre-step', () => {
  it('appends desktop screens on a user turn for an image-capable route', async () => {
    const ctx = await setup(true)
    const owner = agent('vision')
    const decision = await agentEvents(ctx, owner).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [user] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const notice = decision.messages[1]
    expect(notice?.source).toMatchObject({
      kind: 'plugin',
      plugin: PLUGIN_NAME,
      form: 'notice',
    })
    expect(notice?.content.some(block => block.type === 'image')).toBe(true)
  })

  it('skips first-frame attachment for rejects, empty batches, plugin injects, and text-only routes', async () => {
    const vision = await setup(true)
    const owner = agent('vision')
    const rejected = await agentEvents(vision, owner).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(rejected).toEqual({ kind: 'reject' })
    const empty = await agentEvents(vision, owner).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    expect(empty).toEqual({ kind: 'enter', messages: [] })
    const plugin = createUserMessage({
      content: [{ type: 'text', text: 'inject' }],
      source: { kind: 'plugin', plugin: 'fixture', form: 'notice', summary: 'inject' },
    })
    const injected = await agentEvents(vision, owner).waterfall(
      'agent/pre-step',
      { messages: [plugin], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [plugin] }),
    )
    expect(injected).toEqual({ kind: 'enter', messages: [plugin] })
    const textOnly = await setup(false)
    const textAgent = agent('text')
    const skipped = await agentEvents(textOnly, textAgent).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [user] }),
    )
    expect(skipped).toEqual({ kind: 'enter', messages: [user] })
    const unresolvedAgent = {
      id: SessionId('computer-use-pre-unresolved'),
      session: Session.create(SessionId('computer-use-pre-unresolved')),
      options: {},
    } as Agent
    const unresolved = await agentEvents(vision, unresolvedAgent).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [user] }),
    )
    expect(unresolved).toEqual({ kind: 'enter', messages: [user] })
    const noLlm = await setup(true, false)
    const skippedNoLlm = await agentEvents(noLlm, owner).waterfall(
      'agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [user] }),
    )
    expect(skippedNoLlm).toEqual({ kind: 'enter', messages: [user] })
  })
})
