/** Validate the assembled application, including native Office conversion outside ASAR. */
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
if (values.unsigned && !windows && target !== 'mac-arm64' && target !== 'mac-x64') {
  throw new Error('desktop smoke: unsigned artifacts require Windows or macOS')
}
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const application = windows ? join(artifacts, 'win-unpacked')
  : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Orb.app', 'Contents')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)

// Windows qualifies the payload through a short junction: the packaged LibreOffice bootstrap
// cannot open its files past the Win32 MAX_PATH limit, and the staging depth grows with the
// checkout location, so the spawned tree must not inherit it.
const smokeDirectory = windows ? mkdtempSync(join(tmpdir(), 'desktop-smoke-app-')) : undefined
const smokeApplication = smokeDirectory === undefined ? application : join(smokeDirectory, 'app')
if (smokeDirectory !== undefined) symlinkSync(application, smokeApplication, 'junction')
try {
  const smokeResources = join(smokeApplication, windows ? 'resources' : 'Resources')
  const smokeExecutable = windows ? join(smokeApplication, 'DeepSeek Orb.exe')
    : join(smokeApplication, 'MacOS', 'DeepSeek Orb')
  await smokePreparedRuntime(join(smokeResources, 'app.asar', 'dsh'), smokeExecutable,
    join(smokeResources, 'runtime'), descriptor)
} finally {
  if (smokeDirectory !== undefined) rmSync(smokeDirectory, { recursive: true, force: true })
}
