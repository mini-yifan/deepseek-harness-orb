/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'
import { copyComputerUseRuntimeExtra } from './computer-use-runtime-extra.ts'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

/** True when `path` exists, including a dangling symlink. */
function presentPath(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  let resolved: string
  try {
    resolved = realpathSync(source)
  } catch (error) {
    // pnpm's virtual hoist can leave dangling names after a package rename.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  symlinkSync(resolved, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function mirrorDependencyLinks(
  sourceRoot: string,
  destinationRoot: string,
  options: { readonly skipExisting?: boolean } = {},
): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      mkdirSync(join(destinationRoot, entry.name), { recursive: true })
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        const destination = join(destinationRoot, entry.name, scoped.name)
        if (options.skipExisting === true && presentPath(destination)) continue
        linkDirectory(join(source, scoped.name), destination)
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const destination = join(destinationRoot, entry.name)
      if (options.skipExisting === true && presentPath(destination)) continue
      linkDirectory(source, destination)
    }
  }
}

/** Desktop profile bundles whose nested workspace plugins the virtual hoist may omit. */
const PROFILE_BUNDLE_PACKAGES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/**
 * Link workspace plugins from profile-bundle `node_modules` that are absent from
 * the virtual hoist, without replacing names the hoist or the CLI/Host links already own.
 * @param destinationRoot - generated project's `node_modules`.
 */
function supplementProfileBundleLinks(destinationRoot: string): void {
  for (const name of PROFILE_BUNDLE_PACKAGES) {
    const bundle = join(destinationRoot, ...name.split('/'))
    let resolved: string
    try {
      resolved = realpathSync(bundle)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const nested = join(resolved, 'node_modules')
    if (!existsSync(nested)) continue
    mirrorDependencyLinks(nested, destinationRoot, { skipExisting: true })
  }
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, and release identity.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @deepseek-ai/dsh@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@deepseek-ai/dsh-desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @deepseek-ai/dsh-desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }
  const overlayGuardJs = join(options.hostDir, 'lib', 'computer-use-overlay-guard.js')
  if (existsSync(overlayGuardJs) && !readFileSync(overlayGuardJs, 'utf8').includes('excludeWindowIds')) {
    throw new Error(
      'desktop development: Desktop Host overlay-guard is missing excludeWindowIds; rebuild apps/desktop-host',
    )
  }

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  mirrorDependencyLinks(options.dependencyDir, destinationModules)
  const dshLink = join(destinationModules, '@deepseek-ai', 'dsh')
  removeOwnedPath(dshLink)
  linkDirectory(options.cliDir, dshLink)
  const hostLink = join(destinationModules, '@deepseek-ai', 'dsh-desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  supplementProfileBundleLinks(destinationModules)
  const computerUseSource = join(options.hostDir, '..', '..', 'packages', 'experimental', 'tool-computer-use')
  if (existsSync(join(computerUseSource, 'package.json'))) {
    copyComputerUseRuntimeExtra(computerUseSource, options.projectDir)
  }
  return options.projectDir
}
