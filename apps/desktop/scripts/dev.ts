/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import {
  DESKTOP_DEVELOPMENT_MARKET_SPEC,
  developmentStoreHasSpec,
  ensureDevelopmentPluginProfile,
} from '../src/development-plugin-store.ts'
import { prepareDevelopmentProject } from './development-project.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

async function launchElectron(): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = join(DEVELOPMENT_ROOT, 'electron-user-data')
  const pnpm = join(APP_ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_NODE_BINARY: process.execPath,
    DSH_DESKTOP_PNPM_ENTRY: pnpm,
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function buildPackage(cwd: string): Promise<void> {
  const tsc = join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  const tsdown = join(REPOSITORY_ROOT, 'node_modules', '.bin', 'tsdown')
  await run(process.execPath, [tsc, '-b'], cwd)
  await run(tsdown, [], cwd)
}

async function buildComputerUseRuntimeExtra(): Promise<void> {
  const computerUse = join(REPOSITORY_ROOT, 'packages', 'experimental', 'tool-computer-use')
  await buildPackage(computerUse)
  await run(process.execPath, [join(computerUse, 'scripts', 'build-macos-sck-capture.mjs')], computerUse)
}

async function buildSkipBuildArtifacts(): Promise<void> {
  await buildPackage(join(REPOSITORY_ROOT, 'packages', 'host', 'webserver'))
  await buildPackage(join(REPOSITORY_ROOT, 'packages', 'client', 'modules'))
  await buildPackage(join(REPOSITORY_ROOT, 'apps', 'desktop-host'))
  await runPackageScript('build', APP_ROOT)
  await buildComputerUseRuntimeExtra()
  for (const path of [
    join(REPOSITORY_ROOT, 'packages', 'api', 'session-controller'),
    join(REPOSITORY_ROOT, 'packages', 'client', 'ui-layout'),
    join(REPOSITORY_ROOT, 'packages', 'client', 'ui-chat'),
    join(REPOSITORY_ROOT, 'packages', 'client', 'ui-user-questions'),
    join(REPOSITORY_ROOT, 'packages', 'client', 'ui-overlay-chat'),
  ]) {
    await buildPackage(path)
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    await runPackageScript('build', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  } else {
    await buildSkipBuildArtifacts()
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
    pnpmVersion,
  }
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const paths = resolveDesktopPaths(home)
  ensureDevelopmentPluginProfile(paths.profile)
  const pnpm = join(APP_ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (!existsSync(pnpm)) throw new Error('desktop development: apps/desktop/node_modules/pnpm is missing; run pnpm install')
  if (!developmentStoreHasSpec(paths.profile, DESKTOP_DEVELOPMENT_MARKET_SPEC)) {
    const manager = new DesktopProjectManager(paths, {
      node: process.execPath,
      pnpm,
      dsh: join(REPOSITORY_ROOT, 'apps', 'cli'),
    })
    await manager.mutateWhileRunning({ type: 'plugin-add', spec: DESKTOP_DEVELOPMENT_MARKET_SPEC })
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    pluginStoreDir: paths.profile,
  })
  await launchElectron()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
