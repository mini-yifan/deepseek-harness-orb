import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { resolveComputerUseConfig } from '../src/config.ts'
import { createFakeDesktopBackend } from '../src/fake.ts'
import { applyComputerUse } from '../src/plugin.ts'
import * as PresetRoot from '../src/preset-root.ts'
import { apply, name, PRESET_ROOT } from '../src/preset-root.ts'

const GUI_TOOLS = [
  'click', 'drag', 'hotkey', 'input_text', 'list_apps', 'long_press', 'long_wait',
  'open_app', 'open_in_browser', 'open_in_finder', 'screenshot', 'scroll', 'wait',
]

const SOURCE_OVERLAY = fileURLToPath(new URL('../cordis.source.patch.yml', import.meta.url))
const BUILT_OVERLAY = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const COMPOSITION = fileURLToPath(new URL('../presets/computer-use/agent.cordis.yml', import.meta.url))
const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function mintAgentScope(ctx: Context, id: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: id as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, {
    inject: ['tools', 'systemPrompt', 'attachments'],
  }))
  return { scope, key }
}

describe('computer-use preset-root locator', () => {
  it('exports loader identity without a default export', () => {
    expect(name).toBe('computer-use-preset-root')
    expect('inject' in PresetRoot).toBe(false)
    expect('default' in PresetRoot).toBe(false)
  })

  it('provides the existing extra agent-presets root and registers no tools', async () => {
    expect(existsSync(PRESET_ROOT)).toBe(true)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    apply(ctx)
    expect(ctx.get('computerUsePresetRoot')).toBe(PRESET_ROOT)
    expect(ctx.computerUsePresetRoot).toBe(PRESET_ROOT)
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  })
})

describe('computer-use overlay and extra root', () => {
  it('registers the locator and extra root without inserting GUI tools on the Host', async () => {
    const source = await readFile(SOURCE_OVERLAY, 'utf8')
    expect(source).toContain('id: preset-computer-use')
    expect(source).toContain('id: computer-use')
    expect(source).toContain('name: \'./src/index.ts\'')
    expect(source).not.toContain('computer-use-preset-root')

    const built = await readFile(BUILT_OVERLAY, 'utf8')
    expect(built).toContain('id: preset-computer-use')
    expect(built).toContain('name: \'@deepseek-ai/dsh-agent-preset\'')
    expect(built).toContain('name: \'@deepseek-ai/dsh-experimental-tool-computer-use\'')
    expect(built).not.toContain('computer-use-preset-root')
  })

  it('keeps the slim Computer Use composition beside the preset patch', async () => {
    const composition = await readFile(COMPOSITION, 'utf8')
    expect(composition).toContain('name: \'../../src/index.ts\'')
    expect(composition).toContain('postActionWaitMs: 600')
    expect(composition).toContain('name: \'../../src/code-agent.ts\'')
    expect(composition).toContain('@deepseek-ai/dsh-tool-bash')
    expect(composition).toContain('@deepseek-ai/dsh-tool-web')
    expect(composition).toContain('@deepseek-ai/dsh-tool-ask-user')
    expect(composition).toContain('@deepseek-ai/dsh-compaction-basic')
    expect(composition).not.toContain('complete: true')
    expect(composition).not.toContain('name: \'@deepseek-ai/dsh-tool-fs\'')
    expect(composition).not.toContain('@deepseek-ai/dsh-tool-skill')
    expect(composition).not.toContain('@deepseek-ai/dsh-tool-todo')
    expect(composition).not.toContain('@deepseek-ai/dsh-tool-subagent')
    expect(composition).not.toContain('@deepseek-ai/dsh-plan-mode')
    expect(composition).not.toContain('@deepseek-ai/dsh-agent-instructions')
  })
})

describe('computer-use scoped registration', () => {
  it('shows GUI tools only in the scoped catalog', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cu-preset-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const { scope, key } = await mintAgentScope(ctx, 'computer-use-scope')
    applyComputerUse(scope.ctx, createFakeDesktopBackend(), resolveComputerUseConfig({
      postActionWaitMs: 0,
    }))
    expect(ctx.tools.schemas().map(schema => schema.name).some(tool => GUI_TOOLS.includes(tool)))
      .toBe(false)
    expect(ctx.tools.schemas(key).map(schema => schema.name).sort()).toEqual(GUI_TOOLS)
    expect(ctx.tools.schemas(key).map(schema => schema.name)).not.toContain('code_agent')
  })
})
