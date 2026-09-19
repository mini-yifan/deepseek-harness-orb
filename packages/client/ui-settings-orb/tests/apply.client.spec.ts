/**
 * Registration: one settings.section after Agent presets, locale-following
 * nav label, and disposal with the fiber. Catalog and Desktop writes are
 * exercised from the controller specs.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-orb/client'
import { OrbSettingsSection } from '../src/client/OrbSettingsSection.tsx'
import type { OrbSettingsSectionInjected } from '../src/client/section-store.ts'
import { apply as hostApply } from '../src/index.ts'
import { readDesktopAppApi, type OrbMillifractionWriteResult } from '../src/client/desktop-api.ts'

const CATALOG = {
  ok: true as const,
  value: {
    default: { provider: 'deepseek-official', model: 'deepseek-flash' },
    routableProviders: ['deepseek-official'],
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek-V3.2' },
        {
          id: 'deepseek-flash',
          name: 'DeepSeek-V41-Flash',
          reasoning: {
            efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
            defaultEffort: 'max',
          },
        },
      ],
    }],
    failures: [],
  },
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const models = vi.fn((): Promise<
    | typeof CATALOG
    | { ok: false; error: { code: string; message: string } }
  > => Promise.resolve(CATALOG))
  new TestRemote(ctx, { session: { modelCatalog: models } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, models }
}

afterEach(() => { vi.unstubAllGlobals() })

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-orb apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.session'])
  })

  it('registers the floating-ball section after Agent presets', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(OrbSettingsSection)
    expect(section.options).toMatchObject({ id: 'orb', order: 25 })
    expect(resolveSlotLabel(section.options.label)).toBe('悬浮球')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareRoot(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('loads the Desktop snapshot and Host catalog through the injected face', async () => {
    const snapshot = {
      supported: true,
      avatarUrl: 'dsh-app://app/orb-avatar?v=1',
      overlay: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
      background: { provider: 'deepseek-official', model: 'deepseek-chat' },
      selectionEnabled: true,
      millifractionEnabled: true,
    }
    const api = {
      protocolVersion: 1 as const,
      orb: {
        supported: async () => true,
        snapshot: vi.fn(async () => snapshot),
        pickAvatar: vi.fn(),
        restoreAvatar: vi.fn(),
        setOverlayModel: vi.fn(async () => undefined),
        setBackgroundModel: vi.fn(async () => undefined),
        setSelectionEnabled: vi.fn(async () => undefined),
        setMillifractionEnabled: vi.fn(async (): Promise<OrbMillifractionWriteResult> => ({ cancelled: true })),
      },
    }
    vi.stubGlobal('dshDesktop', api)
    const { ctx, slots, models } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => OrbSettingsSectionInjected)()
    await section.load()
    expect(api.orb.snapshot).toHaveBeenCalledTimes(1)
    expect(models).toHaveBeenCalledTimes(1)
    expect(section.hooks.orbSettings.getSnapshot()).toMatchObject({
      status: 'ready',
      supported: true,
      avatarUrl: snapshot.avatarUrl,
      overlay: snapshot.overlay,
      background: snapshot.background,
      selectionEnabled: true,
      millifractionEnabled: true,
    })
    await section.setOverlayModel({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await section.setBackgroundModel({
      provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high',
    })
    await section.setSelectionEnabled(false)
    api.orb.pickAvatar.mockResolvedValueOnce({ ok: false, error: 'too-large' })
    await section.pickAvatar()
    expect(section.hooks.orbSettings.getSnapshot().avatarError).toBe('too-large')
    api.orb.pickAvatar.mockResolvedValueOnce({ ok: false, error: 'cancelled' })
    await section.pickAvatar()
    expect(section.hooks.orbSettings.getSnapshot().avatarError).toBeNull()
    const restored = { ...snapshot, avatarUrl: 'dsh-app://app/orb-avatar?v=0' }
    api.orb.pickAvatar.mockResolvedValueOnce({ ok: true, snapshot: restored })
    await section.pickAvatar()
    expect(section.hooks.orbSettings.getSnapshot().avatarUrl).toBe(restored.avatarUrl)
    api.orb.restoreAvatar.mockResolvedValueOnce(restored)
    await section.restoreAvatar()
    expect(api.orb.restoreAvatar).toHaveBeenCalledTimes(1)
    expect(api.orb.setOverlayModel).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-chat',
    })
    expect(api.orb.setBackgroundModel).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high',
    })
    expect(api.orb.setSelectionEnabled).toHaveBeenCalledWith(false)
    await section.setMillifractionEnabled(false)
    expect(api.orb.setMillifractionEnabled).toHaveBeenCalledWith(false)
    expect(section.hooks.orbSettings.getSnapshot().millifractionEnabled).toBe(true)
    api.orb.setMillifractionEnabled.mockResolvedValueOnce({
      cancelled: false,
      snapshot: { ...snapshot, millifractionEnabled: false },
    })
    await section.setMillifractionEnabled(false)
    expect(section.hooks.orbSettings.getSnapshot().millifractionEnabled).toBe(false)
    expect(section.hooks.orbSettings.getSnapshot().busy).toBe(false)
  })

  it('marks the page unavailable without the Desktop app bridge', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => OrbSettingsSectionInjected)()
    await section.load()
    expect(section.hooks.orbSettings.getSnapshot().status).toBe('unavailable')
    await section.pickAvatar()
    await section.restoreAvatar()
    await section.setOverlayModel({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await section.setSelectionEnabled(false)
    await section.setMillifractionEnabled(false)
    expect(section.hooks.orbSettings.getSnapshot().status).toBe('unavailable')
  })

  it('records load, write, and catalog failures', async () => {
    const snapshot = {
      supported: true,
      avatarUrl: 'dsh-app://app/orb-avatar?v=1',
      overlay: { provider: 'deepseek-official', model: 'deepseek-flash' },
      background: { provider: 'deepseek-official', model: 'deepseek-chat' },
      selectionEnabled: true,
      millifractionEnabled: true,
    }
    const api = {
      protocolVersion: 1 as const,
      orb: {
        supported: async () => true,
        snapshot: vi.fn(async () => snapshot),
        pickAvatar: vi.fn(async () => { throw new Error('pick failed') }),
        restoreAvatar: vi.fn(async () => { throw 'restore failed' }),
        setOverlayModel: vi.fn(async () => { throw new Error('overlay failed') }),
        setBackgroundModel: vi.fn(async () => undefined),
        setSelectionEnabled: vi.fn(async () => { throw new Error('selection failed') }),
        setMillifractionEnabled: vi.fn(async () => { throw new Error('millifraction failed') }),
      },
    }
    vi.stubGlobal('dshDesktop', api)
    const { ctx, slots, models } = await bench()
    models.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'gateway/internal', message: 'no catalog' },
    })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => OrbSettingsSectionInjected)()
    await section.load()
    expect(section.hooks.orbSettings.getSnapshot()).toMatchObject({ status: 'ready', catalog: undefined })
    await section.pickAvatar()
    expect(section.hooks.orbSettings.getSnapshot()).toMatchObject({ status: 'error', error: 'pick failed' })
    await section.restoreAvatar()
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('restore failed')
    await section.setOverlayModel({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('overlay failed')
    api.orb.setBackgroundModel.mockRejectedValueOnce(new Error('background failed'))
    await section.setBackgroundModel({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('background failed')
    await section.setSelectionEnabled(true)
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('selection failed')
    await section.setMillifractionEnabled(false)
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('millifraction failed')
    api.orb.snapshot.mockRejectedValueOnce('snapshot failed')
    await section.load()
    expect(section.hooks.orbSettings.getSnapshot().error).toBe('snapshot failed')
  })

  it('drops the section when its row unloads', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})

describe('readDesktopAppApi', () => {
  it('accepts only protocolVersion 1 with an orb object', () => {
    expect(readDesktopAppApi()).toBeUndefined()
    vi.stubGlobal('dshDesktop', null)
    expect(readDesktopAppApi()).toBeUndefined()
    vi.stubGlobal('dshDesktop', { protocolVersion: 2, orb: {} })
    expect(readDesktopAppApi()).toBeUndefined()
    vi.stubGlobal('dshDesktop', { protocolVersion: 1, orb: null })
    expect(readDesktopAppApi()).toBeUndefined()
    const api = { protocolVersion: 1 as const, orb: {} }
    vi.stubGlobal('dshDesktop', api)
    expect(readDesktopAppApi()).toBe(api)
  })
})
