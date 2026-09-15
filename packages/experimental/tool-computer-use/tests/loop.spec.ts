import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { resolveComputerUseConfig } from '../src/config.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import { applyComputerUse } from '../src/plugin.ts'

class VisionAdapter extends MockAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text', 'image'],
    })
  }
}

class TextAdapter extends MockAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
    })
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function harness(adapter: LlmAdapter) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cu-loop-'))
  homes.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  await ctx.plugin(AgentLoop, { agents: [] })
  const backend = createFakeDesktopBackend()
  applyComputerUse(ctx, backend, resolveComputerUseConfig({ postActionWaitMs: 0 }))
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('computer-use-loop'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, backend }
}

describe('computer-use agent loop', () => {
  it('attaches first-frame screens on a user turn and returns click images on the next request', async () => {
    const adapter = new VisionAdapter([
      toolCallResponse('click-1', 'click', { screen_index: 0, position: [100, 100] }),
      textResponse('DONE'),
    ])
    const { ctx, agent, backend } = await harness(adapter)
    const idle = waitForIdle(ctx, agent)
    send(agent, 'click the button')
    await idle
    expect(backend.actions.some(action => action.type === 'click')).toBe(true)
    const events = agent.session.snapshotEvents()
    const notices = events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && 'plugin' in event.data.source
      && event.data.source.plugin === 'tool-computer-use')
    expect(notices).toHaveLength(1)
    const notice = notices[0]
    if (notice === undefined || notice.type !== 'user/message') {
      throw new Error('expected a first-frame user notice')
    }
    expect(notice.data.content.some(block => block.type === 'image')).toBe(true)
    expect(notice.data.content.some(block =>
      block.type === 'text' && 'text' in block && block.text.includes('<frontmost_app>Pages</frontmost_app>'),
    )).toBe(true)
    const results = events.filter(event => event.type === 'tool/result')
    expect(results.some(event => event.data.message.content.some(block =>
      block.type === 'tool-result' && block.content.some(part =>
        part.type === 'text' && 'text' in part && part.text.includes('<frontmost_app>Pages</frontmost_app>'),
      ),
    ))).toBe(true)
    expect(results.some(event => event.data.message.content.some(block =>
      block.type === 'tool-result' && block.content.some(part => part.type === 'image'),
    ))).toBe(true)
    expect(agent.session.deriveMessages().some(message =>
      message.content.some(block => block.type === 'image'
        || (block.type === 'tool-result' && block.content.some(part => part.type === 'image'))),
    )).toBe(true)
  }, 30_000)

  it('skips first-frame images and refuses GUI tools on a text-only route', async () => {
    const adapter = new TextAdapter([
      toolCallResponse('click-text', 'click', { screen_index: 0, position: [0, 0] }),
      textResponse('ok'),
    ])
    const { ctx, agent, backend } = await harness(adapter)
    const idle = waitForIdle(ctx, agent)
    send(agent, 'do not attach screens')
    await idle
    expect(backend.actions).toEqual([])
    const notices = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && 'plugin' in event.data.source
      && event.data.source.plugin === 'tool-computer-use')
    expect(notices).toEqual([])
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results.some(event => event.data.message.content.some(block =>
      block.type === 'tool-result' && block.isError === true,
    ))).toBe(true)
  }, 30_000)
})
