/**
 * Floating-ball Settings page, browser half — one `settings.section` that
 * reads Desktop profile preferences through `window.dshDesktop` and the Host
 * model catalog through `session/modelCatalog`. The plugin is inserted only
 * by the Desktop Host overlay, so `dsh web` never shows the nav row.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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
  DshDesktopAppApi, OrbAgentModelSelection, OrbAvatarWriteResult, OrbSettingsSnapshot,
} from './desktop-api.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.session']

/**
 * Register the floating-ball Settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new OrbSettingsController(ctx)
  ctx.effect(() => ctx.locale.register('settings.orb', { zh, en }), 'ui-settings-orb: dictionaries')

  const sectionInjected = (): OrbSettingsSectionInjected => ({
    hooks: { orbSettings: controller.store },
    load: () => controller.load(),
    pickAvatar: () => controller.pickAvatar(),
    restoreAvatar: () => controller.restoreAvatar(),
    setOverlayModel: selection => controller.setOverlayModel(selection),
    setBackgroundModel: selection => controller.setBackgroundModel(selection),
    setSelectionEnabled: enabled => controller.setSelectionEnabled(enabled),
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
