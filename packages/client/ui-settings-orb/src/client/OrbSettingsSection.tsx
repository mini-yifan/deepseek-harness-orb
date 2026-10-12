/**
 * Desktop floating-ball Settings section: avatar, overlay and background
 * Agent models, the selection toolbar, millifraction coordinates, and macOS
 * Screen Recording / Accessibility status. Writes apply immediately except
 * millifraction, which confirms then creates a new chat.
 */

import { useEffect, type ReactNode } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { OrbModelPicker } from './OrbModelPicker.tsx'
import type { OrbSettingsSectionInjected } from './section-store.ts'
import type { OrbSettingsKey } from './locales.ts'
import type { TccRightState } from './desktop-api.ts'
import css from './OrbSettingsSection.module.css'

/** Gallery label key per built-in avatar id; an unknown id falls back to the card title. */
const PRESET_LABEL_KEYS: Readonly<Record<string, OrbSettingsKey>> = {
  point: 'avatarPresetPoint',
  rice: 'avatarPresetRice',
  heart: 'avatarPresetHeart',
  cheer: 'avatarPresetCheer',
  cheeks: 'avatarPresetCheeks',
  smile: 'avatarPresetSmile',
}

function presetLabelKey(id: string): OrbSettingsKey {
  return PRESET_LABEL_KEYS[id] ?? 'avatarTitle'
}

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
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('ballTitle')}</h3>
              <p className={css.cardDescription}>{t('ballDescription')}</p>
            </div>
            <Switch
              checked={state.ballEnabled}
              label={t('ballToggle')}
              disabled={disabled}
              onChange={(enabled) => { void props.setBallEnabled(enabled) }}
            />
          </div>
        </section>
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
          {state.avatarPresets.length === 0 ? null : (
            <div className={css.avatarGallery}>
              <p className={css.cardDescription}>{t('avatarPresetsTitle')}</p>
              {state.avatarPresets.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className={css.avatarPreset}
                  aria-pressed={state.avatarPreset === preset.id}
                  aria-label={t(presetLabelKey(preset.id))}
                  title={t(presetLabelKey(preset.id))}
                  disabled={disabled}
                  onClick={() => { void props.setAvatarPreset(preset.id) }}
                >
                  <img src={preset.url} alt="" />
                </button>
              ))}
            </div>
          )}
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
        <section className={css.card}>
          <div className={css.toggleRow}>
            <div className={css.toggleCopy}>
              <h3 className={css.cardTitle}>{t('ribbonTitle')}</h3>
              <p className={css.cardDescription}>{t('ribbonDescription')}</p>
            </div>
            <Switch
              checked={state.observationFrameEnabled}
              label={t('ribbonToggle')}
              disabled={disabled}
              onChange={(enabled) => { void props.setObservationFrameEnabled(enabled) }}
            />
          </div>
        </section>
        {state.supported
          ? (
            <section className={css.card}>
              <h3 className={css.cardTitle}>{t('tccTitle')}</h3>
              <p className={css.cardDescription}>{t('tccDescription')}</p>
              <p className={css.cardDescription}>
                {t('tccAppHint').replaceAll('{name}', state.tcc.appName)}
              </p>
              <div className={css.tccRow}>
                <div className={css.toggleCopy}>
                  <h4 className={css.tccName}>{t('tccScreenName')}</h4>
                  <p className={css.cardDescription}>{t('tccScreenReason')}</p>
                  <p className={css.cardDescription}>{t('tccScreenPath')}</p>
                  <p className={css.tccStatus}>{tccStatusCopy(t, state.tcc.screen)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || state.tcc.screen === 'granted'}
                  onClick={() => { void props.openTcc('screen') }}
                >
                  {t('tccScreenOpen')}
                </Button>
              </div>
              <div className={css.tccRow}>
                <div className={css.toggleCopy}>
                  <h4 className={css.tccName}>{t('tccAccessibilityName')}</h4>
                  <p className={css.cardDescription}>{t('tccAccessibilityReason')}</p>
                  <p className={css.cardDescription}>{t('tccAccessibilityPath')}</p>
                  <p className={css.tccStatus}>{tccStatusCopy(t, state.tcc.accessibility)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || state.tcc.accessibility === 'granted'}
                  onClick={() => { void props.openTcc('accessibility') }}
                >
                  {t('tccAccessibilityOpen')}
                </Button>
              </div>
              <p className={css.cardDescription}>
                {t('tccFooter').replaceAll('{name}', state.tcc.appName)}
              </p>
            </section>
          )
          : null}
      </fieldset>
    </div>
  )
}

export type { OrbSettingsSectionInjected }

function tccStatusCopy(
  t: OrbSettingsSectionProps['t'],
  state: TccRightState,
): string {
  if (state === 'granted') return t('tccStatusGranted')
  if (state === 'needsRelaunch') return t('tccStatusNeedsRelaunch')
  return t('tccStatusMissing')
}
