import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { captureExcludedRegionOnElectron } from '../src/macos-sck-napi.ts'

describe('macos ScreenCaptureKit Electron binding', () => {
  it('queues capture on a libuv worker and never changes activation policy', async () => {
    const source = await readFile(new URL('../src/macos-sck-napi.c', import.meta.url), 'utf8')
    expect(source).toContain('napi_create_async_work')
    expect(source).toContain('dsh_macos_sck_capture')
    expect(source).not.toContain('activationPolicy')
  })

  it('refuses overlay-exclude capture off Darwin', async () => {
    if (process.platform === 'darwin') return
    await expect(captureExcludedRegionOnElectron({
      region: '0,0,10,10',
      excludeWindowIds: [1],
      output: '/tmp/screen.jpg',
    })).rejects.toThrow(/Darwin-only/u)
  })
})
