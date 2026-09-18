import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
import {
  DESKTOP_DEVELOPMENT_MARKET_SPEC,
  developmentStoreHasSpec,
  ensureDevelopmentPluginProfile,
  linkDevelopmentPluginStore,
} from '../src/development-plugin-store.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { parseDesktopPluginArgs } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-plugin-store-'))
  roots.push(root)
  return root
}

function release(): DesktopRelease {
  return {
    schemaVersion: 1,
    version: '1.2.3',
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: '24.17.0',
    pnpmVersion: '11.7.0',
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop development plugin store', () => {
  it('links a persisted market package into the hoist project bundles', () => {
    const root = temporaryRoot()
    const cli = join(root, 'apps', 'cli')
    const host = join(root, 'apps', 'desktop-host')
    const dependencies = join(root, 'workspace-dependencies')
    const store = join(root, 'plugin-store')
    mkdirSync(join(cli, 'lib'), { recursive: true })
    mkdirSync(join(host, 'lib'), { recursive: true })
    mkdirSync(dependencies, { recursive: true })
    writeFileSync(join(cli, 'package.json'), '{"name":"@deepseek-ai/dsh","version":"1.2.3"}\n')
    writeFileSync(join(host, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","version":"1.2.3"}\n')
    writeFileSync(join(host, 'lib', 'index.js'), '')
    ensureDevelopmentPluginProfile(store)
    const market = join(store, 'node_modules', 'dshmarket')
    mkdirSync(market, { recursive: true })
    writeFileSync(join(market, 'package.json'), '{"name":"dshmarket","version":"1.47.0","dsh":{"bundle":{"patch":"./bundle.yml"}}}\n')
    writeFileSync(join(market, 'bundle.yml'), '[]\n')
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { dshmarket: '1.47.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, undefined, 2)}\n`)

    const project = prepareDevelopmentProject({
      projectDir: join(root, 'development'),
      cliDir: cli,
      hostDir: host,
      dependencyDir: dependencies,
      release: release(),
      pluginStoreDir: store,
    })
    expect(realpathSync(join(project, 'node_modules', 'dshmarket'))).toBe(realpathSync(market))
    const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'])
    expect(DESKTOP_DEVELOPMENT_MARKET_SPEC).toBe('dshmarket@1.47.0')
  })

  it('links required hoist peers beside store plugins and skips missing optional peers', () => {
    const root = temporaryRoot()
    const project = join(root, 'project')
    const store = join(root, 'store')
    const schemastery = join(project, 'node_modules', '@deepseek-ai', 'schemastery')
    const cordis = join(project, 'node_modules', '@deepseek-ai', 'cordis')
    mkdirSync(schemastery, { recursive: true })
    mkdirSync(cordis, { recursive: true })
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`)
    writeFileSync(join(schemastery, 'package.json'), '{"name":"@deepseek-ai/schemastery","version":"3.18.1"}\n')
    writeFileSync(join(cordis, 'package.json'), '{"name":"@deepseek-ai/cordis","version":"4.0.1"}\n')
    ensureDevelopmentPluginProfile(store)
    const market = join(store, 'node_modules', 'dshmarket')
    mkdirSync(market, { recursive: true })
    writeFileSync(join(market, 'package.json'), `${JSON.stringify({
      name: 'dshmarket',
      version: '1.47.0',
      peerDependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
        '@deepseek-ai/schemastery': '^3.18.1',
        'missing-optional': '*',
      },
      peerDependenciesMeta: {
        '@deepseek-ai/schemastery': { optional: true },
        'missing-optional': { optional: true },
      },
    })}\n`)
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { dshmarket: '1.47.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, undefined, 2)}\n`)
    linkDevelopmentPluginStore(project, store)
    expect(realpathSync(join(store, 'node_modules', '@deepseek-ai', 'schemastery'))).toBe(realpathSync(schemastery))
    expect(realpathSync(join(store, 'node_modules', '@deepseek-ai', 'cordis'))).toBe(realpathSync(cordis))
    expect(existsSync(join(store, 'node_modules', 'missing-optional'))).toBe(false)
  })

  it('fails when a required plugin peer is missing from the hoist project', () => {
    const root = temporaryRoot()
    const project = join(root, 'project')
    const store = join(root, 'store')
    mkdirSync(join(project, 'node_modules'), { recursive: true })
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`)
    ensureDevelopmentPluginProfile(store)
    const market = join(store, 'node_modules', 'dshmarket')
    mkdirSync(market, { recursive: true })
    writeFileSync(join(market, 'package.json'), `${JSON.stringify({
      name: 'dshmarket',
      version: '1.47.0',
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
    })}\n`)
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { dshmarket: '1.47.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, undefined, 2)}\n`)
    expect(() => { linkDevelopmentPluginStore(project, store) })
      .toThrow(/plugin store requires hoist package @deepseek-ai\/cordis/u)
  })

  it('relinks store plugins after a later install', () => {
    const root = temporaryRoot()
    const project = join(root, 'project')
    const store = join(root, 'store')
    mkdirSync(join(project, 'node_modules'), { recursive: true })
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`)
    ensureDevelopmentPluginProfile(store)
    const extra = join(store, 'node_modules', 'extra-plugin')
    mkdirSync(extra, { recursive: true })
    writeFileSync(join(extra, 'package.json'), '{"name":"extra-plugin","version":"1.0.0"}\n')
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { 'extra-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'extra-plugin'] } },
    }, undefined, 2)}\n`)
    linkDevelopmentPluginStore(project, store)
    expect(realpathSync(join(project, 'node_modules', 'extra-plugin'))).toBe(realpathSync(extra))
  })

  it('reports whether the pinned market spec is already in the store', () => {
    const store = join(temporaryRoot(), 'store')
    expect(developmentStoreHasSpec(store, DESKTOP_DEVELOPMENT_MARKET_SPEC)).toBe(false)
    ensureDevelopmentPluginProfile(store)
    expect(developmentStoreHasSpec(store, DESKTOP_DEVELOPMENT_MARKET_SPEC)).toBe(false)
    const market = join(store, 'node_modules', 'dshmarket')
    mkdirSync(market, { recursive: true })
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { dshmarket: '1.46.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, undefined, 2)}\n`)
    expect(developmentStoreHasSpec(store, DESKTOP_DEVELOPMENT_MARKET_SPEC)).toBe(false)
    writeFileSync(join(store, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime',
      private: true,
      version: '0.0.0',
      dependencies: { dshmarket: '1.47.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, undefined, 2)}\n`)
    expect(developmentStoreHasSpec(store, DESKTOP_DEVELOPMENT_MARKET_SPEC)).toBe(true)
    expect(developmentStoreHasSpec(store, 'dshmarket')).toBe(true)
  })
})

describe('desktop plugin market argv', () => {
  it('accepts registry add and remove and rejects GitHub-only specs', () => {
    expect(parseDesktopPluginArgs(['add', '-w', 'dshmarket@1.47.0', '--reporter=ndjson']))
      .toEqual({ type: 'plugin-add', spec: 'dshmarket@1.47.0' })
    expect(parseDesktopPluginArgs(['remove', 'dshmarket']))
      .toEqual({ type: 'plugin-remove', name: 'dshmarket' })
    expect(() => parseDesktopPluginArgs(['add', 'github:owner/plugin'])).toThrow(/unsupported npm package spec/u)
    expect(() => parseDesktopPluginArgs(['add', 'file:../plugin'])).toThrow(/unsupported npm package spec/u)
    expect(() => parseDesktopPluginArgs(['add', 'dshmarket'])).toThrow(/exact npm version/u)
    expect(() => parseDesktopPluginArgs(['add', 'dshmarket@latest'])).toThrow(/exact npm version/u)
    expect(() => parseDesktopPluginArgs(['add'])).toThrow(/requires an npm package spec/u)
    expect(() => parseDesktopPluginArgs(['remove'])).toThrow(/requires a package name/u)
    expect(() => parseDesktopPluginArgs(['enable', 'dshmarket'])).toThrow(/unsupported plugin command/u)
    expect(() => parseDesktopPluginArgs(['add', '--registry=evil', 'dshmarket@1.47.0'])).toThrow(/unsupported plugin argument/u)
  })
})
