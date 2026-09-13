import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scanRoot } from '@deepseek-ai/dsh-agent-presets'
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

const GUI_TOOLS = ['click', 'hotkey', 'input_text', 'scroll', 'wait']

const SOURCE_OVERLAY = fileURLToPath(new URL('../cordis.source.patch.yml', import.meta.url))
const BUILT_OVERLAY = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const COMPOSITION = fileURLToPath(new URL('../presets/computer-use/agent.cordis.yml', import.meta.url))
const HARNESS_BASE = fileURLToPath(new URL('../../../../apps/cli/', import.meta.url))

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
    expect(source).toContain('id: computer-use-preset-root')
    expect(source).toContain('name: \'./src/preset-root.ts\'')
    expect(source).not.toContain('name: \'./src/index.ts\'')
    expect(source).toContain('id: agent-presets')
    expect(source).toContain('inject: [computerUsePresetRoot]')
    expect(source).toContain('default: standard')
    expect(source).toContain('!!js ctx.computerUsePresetRoot')
    expect(source).toContain('trust: system')

    const built = await readFile(BUILT_OVERLAY, 'utf8')
    expect(built).toContain('name: \'./lib/preset-root.js\'')
    expect(built).not.toContain('name: \'./lib/index.js\'')
    expect(built).toContain('inject: [computerUsePresetRoot]')
    expect(built).toContain('!!js ctx.computerUsePresetRoot')
  })

  it('discovers a computer-use preset whose composition is the slim catalog', async () => {
    const composition = await readFile(COMPOSITION, 'utf8')
    expect(composition).toContain('name: \'../../src/index.ts\'')
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

    const found = await scanRoot(
      { path: PRESET_ROOT, trust: 'system' },
      // Package names resolve from the CLI install, matching production preset health.
      `${pathToFileURL(HARNESS_BASE).href}/`,
    )
    expect(found).toEqual([expect.objectContaining({
      id: 'computer-use',
      trust: 'system',
      name: 'Computer Use 模式',
    })])
    expect(found[0]?.broken).toBeUndefined()
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
      maxWaitSeconds: 0,
      maxScreens: 4,
    }))
    expect(ctx.tools.schemas().map(schema => schema.name).some(tool => GUI_TOOLS.includes(tool)))
      .toBe(false)
    expect(ctx.tools.schemas(key).map(schema => schema.name).sort()).toEqual(GUI_TOOLS)
  })
})
