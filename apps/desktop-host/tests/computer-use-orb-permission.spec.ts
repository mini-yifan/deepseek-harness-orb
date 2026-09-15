import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  apply,
  inject,
  name,
  orbWorkspacePath,
  pinOrbComputerUseFullAccess,
} from '../src/computer-use-orb-permission.ts'

const homes: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-orb-perm-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  return home
}

function sessionOf(id: string, cwd: string | undefined, agentPreset?: string): Session {
  return Session.create(SessionId(id), undefined, {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 0,
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
    ...agentPreset === undefined ? {} : { agentPreset },
  })
}

function recordingPresets(initial = 'workspace-write'): {
  currentValue: string
  applied: string[]
  current: () => string
  set: (session: Session, name: string) => void
} {
  let currentValue = initial
  const applied: string[] = []
  return {
    get currentValue() { return currentValue },
    applied,
    current: () => currentValue,
    set(_session, next) {
      if (currentValue === next) return
      applied.push(next)
      currentValue = next
    },
  }
}

async function mountedPresets(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('orb permission tests do not execute bash') },
    run() { throw new Error('orb permission tests do not execute bash') },
    start() { throw new Error('orb permission tests do not execute bash') },
  })
  ctx.provide('approval', { config: { policy: 'ask' } })
  await ctx.plugin(PermissionPresetService, {})
  return ctx
}

function presetNames(session: Session): string[] {
  return session.snapshotEvents()
    .filter((event): event is typeof event & { type: 'permission/preset' } => event.type === 'permission/preset')
    .map(event => event.data.preset)
}

describe('pinOrbComputerUseFullAccess', () => {
  it('pins Computer Use on the orb workspace', () => {
    const home = isolatedHome()
    const presets = recordingPresets()
    pinOrbComputerUseFullAccess(presets, sessionOf('orb-cu', orbWorkspacePath(), 'computer-use'))
    expect(presets.applied).toEqual(['danger-full-access'])
    expect(presets.currentValue).toBe('danger-full-access')
    expect(orbWorkspacePath()).toBe(join(home, 'dsh_orb'))
  })

  it('leaves standard sessions on the orb workspace unchanged', () => {
    const presets = recordingPresets()
    isolatedHome()
    pinOrbComputerUseFullAccess(presets, sessionOf('orb-std', orbWorkspacePath(), 'standard'))
    expect(presets.applied).toEqual([])
    expect(presets.currentValue).toBe('workspace-write')
  })

  it('leaves Computer Use on another workspace unchanged', () => {
    const home = isolatedHome()
    const presets = recordingPresets()
    pinOrbComputerUseFullAccess(
      presets,
      sessionOf('other-cu', join(home, 'other-project'), 'computer-use'),
    )
    expect(presets.applied).toEqual([])
    expect(presets.currentValue).toBe('workspace-write')
  })

  it('appends nothing when Full access is already current', () => {
    isolatedHome()
    const presets = recordingPresets('danger-full-access')
    pinOrbComputerUseFullAccess(presets, sessionOf('orb-cu-full', orbWorkspacePath(), 'computer-use'))
    expect(presets.applied).toEqual([])
    expect(presets.currentValue).toBe('danger-full-access')
  })
})

describe('computer-use-orb-permission plugin', () => {
  it('does not throw when permission presets are absent', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, inject, apply })
  })

  it('upgrades Computer Use on the orb workspace after the Host pin', async () => {
    isolatedHome()
    const ctx = await mountedPresets()
    await ctx.plugin({ name, inject, apply })
    const session = ctx.sessions.create(SessionId('orb-cu'), {
      meta: { cwd: orbWorkspacePath(), agentPreset: 'computer-use' },
    })
    expect(ctx.permissionPresets.current(session)).toBe('danger-full-access')
    expect(presetNames(session)).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('leaves standard on the orb workspace at workspace-write', async () => {
    isolatedHome()
    const ctx = await mountedPresets()
    await ctx.plugin({ name, inject, apply })
    const session = ctx.sessions.create(SessionId('orb-std'), {
      meta: { cwd: orbWorkspacePath(), agentPreset: 'standard' },
    })
    expect(ctx.permissionPresets.current(session)).toBe('workspace-write')
    expect(presetNames(session)).toEqual(['workspace-write'])
  })

  it('leaves Computer Use on another workspace at workspace-write', async () => {
    const home = isolatedHome()
    const ctx = await mountedPresets()
    await ctx.plugin({ name, inject, apply })
    const session = ctx.sessions.create(SessionId('other-cu'), {
      meta: { cwd: join(home, 'other-project'), agentPreset: 'computer-use' },
    })
    expect(ctx.permissionPresets.current(session)).toBe('workspace-write')
    expect(presetNames(session)).toEqual(['workspace-write'])
  })

  it('appends nothing when an orb Computer Use session is already Full access', async () => {
    isolatedHome()
    const ctx = await mountedPresets()
    await ctx.plugin({ name, inject, apply })
    const session = ctx.sessions.create(SessionId('orb-cu'), {
      meta: { cwd: orbWorkspacePath(), agentPreset: 'computer-use' },
    })
    expect(presetNames(session)).toEqual(['workspace-write', 'danger-full-access'])
    pinOrbComputerUseFullAccess(ctx.permissionPresets, session)
    expect(presetNames(session)).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('upgrades an already-announced orb Computer Use session at apply', async () => {
    isolatedHome()
    const ctx = await mountedPresets()
    const session = ctx.sessions.create(SessionId('orb-cu-resume'), {
      meta: { cwd: orbWorkspacePath(), agentPreset: 'computer-use' },
    })
    expect(ctx.permissionPresets.current(session)).toBe('workspace-write')
    await ctx.plugin({ name, inject, apply })
    expect(ctx.permissionPresets.current(session)).toBe('danger-full-access')
    expect(presetNames(session)).toEqual(['workspace-write', 'danger-full-access'])
  })
})
