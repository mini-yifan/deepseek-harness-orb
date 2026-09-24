import { describe, expect, it, vi } from 'vitest'
import { runDesktopPluginArgs, type DesktopPluginRunner } from '../src/plugin-run.ts'

function manager(mutateWhileRunning: DesktopPluginRunner['mutateWhileRunning']): DesktopPluginRunner {
  return { mutateWhileRunning }
}

describe('desktop plugin-run IPC adapter', () => {
  it('runs an exact registry add without stopping the Host', async () => {
    const mutateWhileRunning = vi.fn(async () => undefined)
    const stderr: string[] = []
    await expect(runDesktopPluginArgs(
      manager(mutateWhileRunning),
      ['add', '-w', 'dshmarket@1.47.0', '--reporter=ndjson'],
      { stdout() {}, stderr(chunk) { stderr.push(chunk) } },
    )).resolves.toEqual({ exitCode: 0, signal: null })
    expect(mutateWhileRunning).toHaveBeenCalledWith(
      { type: 'plugin-add', spec: 'dshmarket@1.47.0' },
      expect.anything(),
      undefined,
    )
    expect(stderr).toEqual([])
  })

  it('returns exit code 1 for GitHub-only specs and pnpm failures', async () => {
    const stderr: string[] = []
    await expect(runDesktopPluginArgs(
      manager(async () => undefined),
      ['add', 'github:owner/plugin'],
      { stdout() {}, stderr(chunk) { stderr.push(chunk) } },
    )).resolves.toEqual({ exitCode: 1, signal: null })
    expect(stderr.join('')).toMatch(/unsupported npm package spec/u)
    stderr.length = 0
    await expect(runDesktopPluginArgs(
      manager(async () => { throw new Error('pnpm exited with 1') }),
      ['add', 'plugin@1.0.0'],
      { stdout() {}, stderr(chunk) { stderr.push(chunk) } },
    )).resolves.toEqual({ exitCode: 1, signal: null })
    expect(stderr).toEqual(['pnpm exited with 1'])
  })
})
