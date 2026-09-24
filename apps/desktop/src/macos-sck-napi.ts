/** Load the Darwin ScreenCaptureKit overlay-exclude binding in the Electron process. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface MacosSckNapiBinding {
  capture(region: string, exclude: string, output: string): Promise<void>
}

let binding: MacosSckNapiBinding | undefined

function loadBinding(): MacosSckNapiBinding {
  if (binding !== undefined) return binding
  if (process.platform !== 'darwin') {
    throw new Error('dsh desktop: overlay-exclude capture is Darwin-only')
  }
  const require = createRequire(import.meta.url)
  binding = require(join(dirname(fileURLToPath(import.meta.url)), 'macos-sck-napi.node')) as MacosSckNapiBinding
  return binding
}

/**
 * Capture `region` as JPEG at `output`, omitting overlay CGWindowIDs inside this Electron process.
 * @param input - region `x,y,w,h`, overlay window ids, and JPEG destination path.
 */
export async function captureExcludedRegionOnElectron(input: {
  readonly region: string
  readonly excludeWindowIds: readonly number[]
  readonly output: string
}): Promise<void> {
  await loadBinding().capture(input.region, input.excludeWindowIds.join(','), input.output)
}
