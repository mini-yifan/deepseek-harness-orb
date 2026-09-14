import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, computerUsePresetRoot } from '../src/computer-use-preset-root.ts'

const OVERLAY = fileURLToPath(new URL('../config/desktop.cordis.patch.yml', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop Computer Use overlay', () => {
  it('inserts the locator and keeps the deployment default on standard', () => {
    const overlay = readFileSync(OVERLAY, 'utf8')
    expect(overlay).toContain('id: computer-use-preset-root')
    expect(overlay).toContain("name: '../lib/computer-use-preset-root.js'")
    expect(overlay).toContain('inject: [computerUsePresetRoot]')
    expect(overlay).toContain('default: standard')
    expect(overlay).not.toContain('default: computer-use')
    expect(overlay).not.toContain('modeSelectionEnabled: false')
  })

  it('resolves the extra presets directory only when the runtime package exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-cu-root-'))
    roots.push(root)
    expect(computerUsePresetRoot(root)).toBeUndefined()
    const presets = join(root, 'node_modules', '@deepseek-ai', 'dsh-experimental-tool-computer-use', 'presets')
    mkdirSync(presets, { recursive: true })
    writeFileSync(join(presets, '.keep'), '')
    expect(computerUsePresetRoot(root)).toBe(presets)
  })

  it('publishes the extra presets directory for agent-presets inject', () => {
    const ctx = new Context()
    apply(ctx)
    expect(existsSync(ctx.computerUsePresetRoot)).toBe(true)
    expect(ctx.computerUsePresetRoot).toMatch(/tool-computer-use[/\\]presets$/u)
  })
})
