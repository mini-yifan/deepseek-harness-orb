/** Compile the Darwin ScreenCaptureKit overlay-exclude helper and in-process library beside lib/. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = resolve(packageRoot, 'src/macos-sck-capture.swift')
const output = resolve(packageRoot, 'lib/macos-sck-capture')
const dylib = resolve(packageRoot, 'lib/libmacos-sck-capture.dylib')
const frameworks = [
  '-framework', 'AppKit',
  '-framework', 'ScreenCaptureKit',
  '-framework', 'CoreGraphics',
  '-framework', 'ImageIO',
  '-framework', 'UniformTypeIdentifiers',
]

mkdirSync(dirname(output), { recursive: true })
if (process.platform !== 'darwin') {
  writeFileSync(output, 'macos-sck-capture is Darwin-only\n')
  writeFileSync(dylib, 'libmacos-sck-capture is Darwin-only\n')
  process.exit(0)
}

function compile(args, label) {
  const result = spawnSync('swiftc', args, { cwd: packageRoot, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label}: swiftc exited with ${String(result.status ?? result.signal)}`)
  }
}

compile([
  '-O',
  '-parse-as-library',
  '-D',
  'DSH_SCK_CLI',
  '-o',
  output,
  source,
  ...frameworks,
], 'macos-sck-capture')
compile([
  '-O',
  '-parse-as-library',
  '-emit-library',
  '-Xlinker',
  '-install_name',
  '-Xlinker',
  '@rpath/libmacos-sck-capture.dylib',
  '-o',
  dylib,
  source,
  ...frameworks,
], 'libmacos-sck-capture')
