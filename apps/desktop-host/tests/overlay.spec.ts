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
  it('does not hide overlay sessions from the main window', () => {
    const index = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')
    expect(index).not.toContain('__DSH_HIDDEN_SESSION_IDS__')
  })

  it('inserts the locator and keeps the deployment default on standard', () => {
    const overlay = readFileSync(OVERLAY, 'utf8')
    expect(overlay).toContain('id: ui-directory-picker-native')
    expect(overlay).toContain("name: '@deepseek-ai/dsh-client-ui-settings-orb'")
    expect(overlay).toContain('id: ui-settings-orb')
    expect(overlay).toContain('id: computer-use-preset-root')
    expect(overlay).toContain("name: '../lib/computer-use-preset-root.js'")
    expect(overlay).toContain('id: computer-use-overlay-guard')
    expect(overlay).toContain("name: '../lib/computer-use-overlay-guard.js'")
    expect(overlay).toContain('id: computer-use-orb-permission')
    expect(overlay).toContain("name: '../lib/computer-use-orb-permission.js'")
    expect(overlay).toContain('id: computer-use-orb-code-agent-model')
    expect(overlay).toContain("name: '../lib/computer-use-orb-code-agent-model.js'")
    expect(overlay).toContain('id: computer-use-orb-coordinate-mode')
    expect(overlay).toContain("name: '../lib/computer-use-orb-coordinate-mode.js'")
    expect(overlay).toContain('inject: [computerUsePresetRoot]')
    expect(overlay).toContain('id: webserver')
    expect(overlay).toContain('listen: false')
    expect(overlay).not.toMatch(/id: webserver\n  disabled: true/u)
    expect(overlay).toContain('default: standard')
    expect(overlay).not.toContain('default: computer-use')
    expect(overlay).not.toContain('modeSelectionEnabled: false')
    const web = readFileSync(fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url)), 'utf8')
    expect(web).not.toContain('ui-settings-orb')
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
