import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadMacosSelectionBinding } from '../src/macos-selection-napi.ts'

describe('macos selection Electron binding', () => {
  it('queues events on a threadsafe function and never changes activation policy', async () => {
    const source = await readFile(new URL('../src/macos-selection-napi.c', import.meta.url), 'utf8')
    expect(source).toContain('napi_create_threadsafe_function')
    expect(source).toContain('dsh_macos_selection_start')
    expect(source).toContain('dsh_macos_selection_last_front_pid')
    expect(source).not.toContain('activationPolicy')
  })

  it('refuses the selection binding off Darwin', () => {
    if (process.platform === 'darwin') return
    expect(() => loadMacosSelectionBinding()).toThrow(/Darwin-only/u)
  })
})
