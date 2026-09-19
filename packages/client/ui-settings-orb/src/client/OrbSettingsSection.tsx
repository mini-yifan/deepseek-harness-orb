/**
 * Desktop floating-ball Settings section: avatar, overlay and background
 * Agent models, the selection toolbar, and millifraction coordinates. Writes
 * apply immediately except millifraction, which confirms then creates a new chat.
 */

import { useEffect, type ReactNode } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { OrbModelPicker } from './OrbModelPicker.tsx'
import type { OrbSettingsSectionInjected } from './section-store.ts'
import css from './OrbSettingsSection.module.css'

/** Full component props. */
export type OrbSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.orb'>
  & InjectFace<OrbSettingsSectionInjected>

/**
 * Render the floating-ball Settings page.
 * @param props - locale copy, the page snapshot, and persist actions.
 * @returns the section column.
 */
export function OrbSettingsSection(props: OrbSettingsSectionProps): ReactNode {
  const { useOrbSettings, t, load } = props
  const state = useOrbSettings(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'unavailable') {
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{t('unavailable')}</p>
      </div>
    )
  }
  if (state.status === 'error') {
    const detail = state.error ?? ''
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${detail}`}</p>
        <Button variant="outline" size="sm" onClick={() => { void load() }}>{t('retry')}</Button>
      </div>
    )
  }

  const disabled = !state.supported || state.busy || state.status !== 'ready'
  const avatarMessage = state.avatarError === 'too-large'
    ? t('tooLarge')
    : state.avatarError === 'invalid-type'
      ? t('invalidType')
      : null

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('sectionIntro')}</p>
      {!state.supported && state.status === 'ready'
        ? <p className={css.banner} role="status">{t('macosOnly')}</p>
        : null}
      <fieldset className={css.fields} disabled={disabled}>
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('avatarTitle')}</h3>
          <p className={css.cardDescription}>{t('avatarDescription')}</p>
          <div className={css.avatarRow}>
            {state.avatarUrl === ''
              ? <div className={css.avatar} aria-hidden="true" />
              : <img className={css.avatar} src={state.avatarUrl} alt={t('avatarAlt')} />}
            <div className={css.avatarActions}>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => { void props.pickAvatar() }}
              >
                {t('chooseImage')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => { void props.restoreAvatar() }}
              >
                {t('restoreDefault')}
              </Button>
            </div>
          </div>
          {avatarMessage === null ? null : <p className={css.error} role="alert">{avatarMessage}</p>}
        </section>
        <section className={css.card}>
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('overlayTitle')}</h3>
              <p className={css.cardDescription}>{t('overlayDescription')}</p>
            </div>
            <OrbModelPicker
              label={t('overlayTitle')}
              catalog={state.catalog}
              current={state.overlay}
              disabled={disabled}
              emptyLabel={t('emptyCatalog')}
              defaultEffortLabel={t('defaultEffort')}
              onSelect={(selection) => { void props.setOverlayModel(selection) }}
            />
          </div>
        </section>
        <section className={css.card}>
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('backgroundTitle')}</h3>
              <p className={css.cardDescription}>{t('backgroundDescription')}</p>
            </div>
            <OrbModelPicker
              label={t('backgroundTitle')}
              catalog={state.catalog}
              current={state.background}
              disabled={disabled}
              emptyLabel={t('emptyCatalog')}
              defaultEffortLabel={t('defaultEffort')}
              onSelect={(selection) => { void props.setBackgroundModel(selection) }}
            />
          </div>
        </section>
        <section className={css.card}>
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('selectionTitle')}</h3>
              <p className={css.cardDescription}>{t('selectionDescription')}</p>
            </div>
            <Switch
              checked={state.selectionEnabled}
              label={t('selectionToggle')}
              disabled={disabled}
              onChange={(enabled) => { void props.setSelectionEnabled(enabled) }}
            />
          </div>
        </section>
        <section className={css.card}>
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('millifractionTitle')}</h3>
              <p className={css.cardDescription}>{t('millifractionDescription')}</p>
            </div>
            <Switch
              checked={state.millifractionEnabled}
              label={t('millifractionToggle')}
              disabled={disabled}
              onChange={(enabled) => { void props.setMillifractionEnabled(enabled) }}
            />
          </div>
        </section>
      </fieldset>
    </div>
  )
}

export type { OrbSettingsSectionInjected }
