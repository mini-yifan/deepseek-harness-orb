/**
 * Floating-ball Settings page, browser half — one `settings.section` that
 * reads Desktop profile preferences through `window.dshDesktop` and the Host
 * model catalog through `session/modelCatalog`. The plugin is inserted only
 * by the Desktop Host overlay, so `dsh web` never shows the nav row.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { readDesktopAppApi } from './desktop-api.ts'
import { OrbSettingsSection } from './OrbSettingsSection.tsx'
import type { OrbSettingsSectionInjected } from './section-store.ts'
import { OrbSettingsController } from './section-store.ts'
import { en, zh, type OrbSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Floating-ball Settings copy. */
    'settings.orb': OrbSettingsKey
  }
}

export type { OrbSettingsSectionInjected, OrbSettingsSectionProps } from './OrbSettingsSection.tsx'
export type {
  OrbCatalogModel, OrbModelCatalog, OrbModelProviderGroup, OrbSettingsState,
} from './section-store.ts'
export type {
  DshDesktopAppApi, OrbAgentModelSelection, OrbAvatarWriteResult, OrbMillifractionWriteResult,
  OrbSettingsSnapshot,
} from './desktop-api.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'uiWorkspace']

/**
 * Register the floating-ball Settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new OrbSettingsController(ctx)
  ctx.effect(() => ctx.locale.register('settings.orb', { zh, en }), 'ui-settings-orb: dictionaries')

  // The floating ball's agent strip asks this window to open a background session; the
  // Settings package is the orb's main-window half, so the bridge lives here.
  const desktop = readDesktopAppApi()
  if (desktop !== undefined) {
    ctx.effect(
      () => desktop.orb.onOpenSession((sessionId) => {
        ctx.uiWorkspace.openSession(brandString<SessionId>(sessionId))
      }),
      'ui-settings-orb: agent-strip jump',
    )
  }

  const sectionInjected = (): OrbSettingsSectionInjected => ({
    hooks: { orbSettings: controller.store },
    load: () => controller.load(),
    pickAvatar: () => controller.pickAvatar(),
    restoreAvatar: () => controller.restoreAvatar(),
    setAvatarPreset: preset => controller.setAvatarPreset(preset),
    setOverlayModel: selection => controller.setOverlayModel(selection),
    setBackgroundModel: selection => controller.setBackgroundModel(selection),
    setSelectionEnabled: enabled => controller.setSelectionEnabled(enabled),
    setMillifractionEnabled: enabled => controller.setMillifractionEnabled(enabled),
    openTcc: right => controller.openTcc(right),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'orb',
    order: 25,
    label: () => ctx.locale.bind('settings.orb')('nav'),
    locale: 'settings.orb',
    inject: sectionInjected,
  }, OrbSettingsSection))
}
