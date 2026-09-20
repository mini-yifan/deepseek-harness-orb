/** Compile the Darwin in-process ScreenCaptureKit overlay-exclude binding beside lib/. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(packageRoot, '../..')
const swiftSource = resolve(repoRoot, 'packages/experimental/tool-computer-use/src/macos-sck-capture.swift')
const napiSource = resolve(packageRoot, 'src/macos-sck-napi.c')
const dylib = resolve(packageRoot, 'lib/libmacos-sck-capture.dylib')
const output = resolve(packageRoot, 'lib/macos-sck-napi.node')
const frameworks = [
  '-framework', 'AppKit',
  '-framework', 'ScreenCaptureKit',
  '-framework', 'CoreGraphics',
  '-framework', 'ImageIO',
  '-framework', 'UniformTypeIdentifiers',
]

mkdirSync(dirname(output), { recursive: true })
if (process.platform !== 'darwin') {
  writeFileSync(dylib, 'libmacos-sck-capture is Darwin-only\n')
  writeFileSync(output, 'macos-sck-napi is Darwin-only\n')
  process.exit(0)
}

function nodeApiInclude() {
  const execDir = dirname(process.execPath)
  const candidates = [
    typeof process.config?.variables?.nodedir === 'string'
      ? join(process.config.variables.nodedir, 'include', 'node')
      : undefined,
    typeof process.config?.variables?.nodedir === 'string' ? process.config.variables.nodedir : undefined,
    join(execDir, '..', 'include', 'node'),
    join(execDir, '..', '..', 'include', 'node'),
    '/usr/local/include/node',
  ]
  for (const dir of candidates) {
    if (dir !== undefined && existsSync(join(dir, 'node_api.h'))) return dir
  }
  throw new Error('macos-sck-napi: node_api.h not found')
}

function compile(command, args, label) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label}: ${command} exited with ${String(result.status ?? result.signal)}`)
  }
}

compile('swiftc', [
  '-O',
  '-parse-as-library',
  '-emit-library',
  '-Xlinker',
  '-install_name',
  '-Xlinker',
  '@rpath/libmacos-sck-capture.dylib',
  '-o',
  dylib,
  swiftSource,
  ...frameworks,
], 'libmacos-sck-capture')
compile('clang', [
  '-shared',
  '-fPIC',
  '-undefined',
  'dynamic_lookup',
  `-I${nodeApiInclude()}`,
  napiSource,
  dylib,
  '-Wl,-rpath,@loader_path',
  '-o',
  output,
], 'macos-sck-napi')
