/**
 * Persist unpackaged Desktop plugins across `start:desktop` project rebuilds.
 * The hoist project is wiped every launch; this store is the real pnpm profile.
 * Host peer packages are linked from the hoist into the store so Node ESM
 * resolution after realpath can load them beside the store copies.
 * @module @deepseek-ai/dsh-desktop/development-plugin-store
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createPluginProfile, packageNameFromSpec } from './project-manager.ts'

/** Exact npm spec pinned into the unpackaged development plugin store. */
export const DESKTOP_DEVELOPMENT_MARKET_SPEC = 'dshmarket@1.47.0'

const CORE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

interface StoreManifest {
  readonly dependencies?: Record<string, string>
  readonly dsh?: {
    readonly profile?: {
      readonly bundles?: unknown
    }
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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
  if (presentPath(destination)) unlinkSync(destination)
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function storeManifest(storeDir: string): StoreManifest {
  const value = readJson(join(storeDir, 'package.json'))
  if (!isRecord(value)) throw new Error(`desktop development: invalid plugin store manifest ${storeDir}`)
  return value as StoreManifest
}

function optionalPeerNames(manifest: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>()
  if (!isRecord(manifest.peerDependenciesMeta)) return names
  for (const [name, meta] of Object.entries(manifest.peerDependenciesMeta)) {
    if (isRecord(meta) && meta.optional === true) names.add(name)
  }
  return names
}

function hoistPackage(projectDir: string, name: string): string {
  return join(projectDir, 'node_modules', ...name.split('/'))
}

function storePackage(storeDir: string, name: string): string {
  return join(storeDir, 'node_modules', ...name.split('/'))
}

/**
 * Link each store plugin's host peers from the hoist project into the store.
 * ESM realpath of a store plugin does not search the hoist `node_modules`.
 * @param projectDir - disposable development hoist project.
 * @param storeDir - persistent plugin profile.
 */
function linkStoreHostPeers(projectDir: string, storeDir: string): void {
  const plugins = new Set(Object.keys(storeManifest(storeDir).dependencies ?? {}))
  const required = new Set<string>()
  const optional = new Set<string>()
  for (const name of plugins) {
    const manifestPath = join(storePackage(storeDir, name), 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    if (!isRecord(manifest)) throw new Error(`desktop development: invalid plugin manifest ${manifestPath}`)
    if (manifest.peerDependencies === undefined) continue
    if (!isRecord(manifest.peerDependencies)
      || Object.values(manifest.peerDependencies).some(spec => typeof spec !== 'string')) {
      throw new Error(`desktop development: invalid peerDependencies in ${manifestPath}`)
    }
    const optionalPeers = optionalPeerNames(manifest)
    for (const peer of Object.keys(manifest.peerDependencies)) {
      if (plugins.has(peer)) continue
      if (optionalPeers.has(peer)) optional.add(peer)
      else required.add(peer)
    }
  }
  for (const name of [...required].sort()) linkHostPeer(projectDir, storeDir, name, true)
  for (const name of [...optional].sort()) {
    if (required.has(name)) continue
    linkHostPeer(projectDir, storeDir, name, false)
  }
}

function linkHostPeer(projectDir: string, storeDir: string, name: string, required: boolean): void {
  const source = hoistPackage(projectDir, name)
  if (!existsSync(join(source, 'package.json'))) {
    if (!required) return
    throw new Error(`desktop development: plugin store requires hoist package ${name}`)
  }
  const destination = storePackage(storeDir, name)
  if (presentPath(destination) && !lstatSync(destination).isSymbolicLink()) return
  linkDirectory(source, destination)
}

function enabledStorePlugins(storeDir: string): readonly string[] {
  const bundles = storeManifest(storeDir).dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) return []
  return bundles.slice(CORE_BUNDLES.length)
}

/**
 * Create the development plugin profile when missing.
 * @param storeDir - `$DSH_HOME/profiles/desktop` for unpackaged launches.
 */
export function ensureDevelopmentPluginProfile(storeDir: string): void {
  if (!existsSync(join(storeDir, 'package.json'))) createPluginProfile(storeDir)
}

/**
 * Link every installed store package into the disposable hoist project and merge enabled bundles.
 * Then link each plugin's host peers from the hoist into the store.
 * @param projectDir - wiped development hoist project.
 * @param storeDir - persistent plugin profile.
 */
export function linkDevelopmentPluginStore(projectDir: string, storeDir: string): void {
  if (!existsSync(join(storeDir, 'package.json'))) return
  const dependencies = storeManifest(storeDir).dependencies ?? {}
  const destinationModules = join(projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  for (const name of Object.keys(dependencies)) {
    const source = storePackage(storeDir, name)
    if (!existsSync(source)) continue
    linkDirectory(source, join(destinationModules, ...name.split('/')))
  }
  linkStoreHostPeers(projectDir, storeDir)
  const projectPath = join(projectDir, 'package.json')
  const project = readJson(projectPath)
  if (!isRecord(project) || !isRecord(project.dsh) || !isRecord(project.dsh.profile)
    || !Array.isArray(project.dsh.profile.bundles)) {
    throw new Error(`desktop development: invalid hoist project manifest ${projectPath}`)
  }
  const plugins = enabledStorePlugins(storeDir)
  const bundles = [...CORE_BUNDLES, ...plugins]
  if (new Set(bundles).size !== bundles.length) {
    throw new Error('desktop development: plugin store bundle list contains a duplicate package')
  }
  writeFileSync(projectPath, `${JSON.stringify({
    ...project,
    dsh: {
      ...project.dsh,
      profile: {
        ...project.dsh.profile,
        bundles,
      },
    },
  }, undefined, 2)}\n`)
}

/**
 * True when the store already records the requested exact npm spec.
 * @param storeDir - persistent plugin profile.
 * @param spec - `name@version` registry spec.
 */
export function developmentStoreHasSpec(storeDir: string, spec: string): boolean {
  if (!existsSync(join(storeDir, 'package.json'))) return false
  const name = packageNameFromSpec(spec)
  const versionAt = spec.lastIndexOf('@')
  const version = versionAt > 0 ? spec.slice(name.length + 1) : undefined
  const installed = storeManifest(storeDir).dependencies?.[name]
  if (installed === undefined) return false
  if (version !== undefined && installed !== version) return false
  return existsSync(join(storeDir, 'node_modules', ...name.split('/')))
}
