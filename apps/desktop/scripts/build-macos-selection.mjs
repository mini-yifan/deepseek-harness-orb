/** Compile the Darwin in-process selection monitor beside lib/. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const swiftSource = resolve(packageRoot, 'src/macos-selection.swift')
const napiSource = resolve(packageRoot, 'src/macos-selection-napi.c')
const dylib = resolve(packageRoot, 'lib/libmacos-selection.dylib')
const output = resolve(packageRoot, 'lib/macos-selection-napi.node')
const frameworks = [
  '-framework', 'AppKit',
  '-framework', 'ApplicationServices',
  '-framework', 'CoreGraphics',
]

mkdirSync(dirname(output), { recursive: true })
const leftoverExecutable = resolve(packageRoot, 'lib/macos-selection')
if (existsSync(leftoverExecutable)) unlinkSync(leftoverExecutable)
if (process.platform !== 'darwin') {
  writeFileSync(dylib, 'libmacos-selection is Darwin-only\n')
  writeFileSync(output, 'macos-selection-napi is Darwin-only\n')
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
  throw new Error('macos-selection-napi: node_api.h not found')
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
  '@rpath/libmacos-selection.dylib',
  '-o',
  dylib,
  swiftSource,
  ...frameworks,
], 'libmacos-selection')
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
], 'macos-selection-napi')
