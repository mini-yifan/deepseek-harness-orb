/** Compile the Darwin ScreenCaptureKit overlay-exclude helper beside lib/. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = resolve(packageRoot, 'src/macos-sck-capture.swift')
const output = resolve(packageRoot, 'lib/macos-sck-capture')

mkdirSync(dirname(output), { recursive: true })
if (process.platform !== 'darwin') {
  writeFileSync(output, 'macos-sck-capture is Darwin-only\n')
  process.exit(0)
}

const result = spawnSync('swiftc', [
  '-O',
  '-parse-as-library',
  '-o',
  output,
  source,
  '-framework',
  'ScreenCaptureKit',
  '-framework',
  'CoreGraphics',
  '-framework',
  'ImageIO',
  '-framework',
  'UniformTypeIdentifiers',
], { cwd: packageRoot, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  throw new Error(`macos-sck-capture: swiftc exited with ${String(result.status ?? result.signal)}`)
}
