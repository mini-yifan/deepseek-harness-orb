// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OrbModelPicker } from '../src/client/OrbModelPicker.tsx'
import { OrbSettingsSection } from '../src/client/OrbSettingsSection.tsx'
import type { OrbSettingsSectionProps } from '../src/client/OrbSettingsSection.tsx'
import type { OrbSettingsState } from '../src/client/section-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: OrbSettingsState = {
  status: 'ready',
  error: null,
  supported: true,
  avatarUrl: 'dsh-app://app/orb-avatar?v=1',
  avatarError: null,
  overlay: { provider: 'deepseek-official', model: 'deepseek-flash' },
  background: { provider: 'deepseek-official', model: 'deepseek-chat' },
  selectionEnabled: true,
  millifractionEnabled: true,
  catalog: {
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
  },
  busy: false,
}

function mount(state: Partial<OrbSettingsState> = {}) {
  const store = createSnapshotStore<OrbSettingsState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    pickAvatar: vi.fn(() => Promise.resolve()),
    restoreAvatar: vi.fn(() => Promise.resolve()),
    setOverlayModel: vi.fn(() => Promise.resolve()),
    setBackgroundModel: vi.fn(() => Promise.resolve()),
    setSelectionEnabled: vi.fn(() => Promise.resolve()),
    setMillifractionEnabled: vi.fn(() => Promise.resolve()),
  }
  render(<OrbSettingsSection {...({
    ...actions,
    useOrbSettings: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as OrbSettingsSectionProps)} />)
  return actions
}

describe('OrbSettingsSection', () => {
  it('loads on mount and persists avatar, models, and selection immediately', () => {
    const actions = mount()
    expect(actions.load).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
    const overlay = screen.getByRole('button', { name: 'Floating-ball Agent' })
    expect(overlay.textContent).toContain('DeepSeek-V41-Flash')
    expect(overlay.textContent).toContain('Max')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(overlay)
    fireEvent.click(screen.getByRole('menuitem', { name: 'DeepSeek-V3.2' }))
    fireEvent.click(overlay)
    const flash = screen.getByRole('menuitem', { name: 'DeepSeek-V41-Flash' })
    fireEvent.mouseEnter(flash.parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Background Agent' }))
    const backgroundFlash = screen.getByRole('menuitem', { name: 'DeepSeek-V41-Flash' })
    fireEvent.mouseEnter(backgroundFlash.parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'High' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable the selection toolbar' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Use millifraction coordinates' }))
    expect(actions.pickAvatar).toHaveBeenCalledTimes(1)
    expect(actions.restoreAvatar).toHaveBeenCalledTimes(1)
    expect(actions.setOverlayModel).toHaveBeenNthCalledWith(1, {
      provider: 'deepseek-official', model: 'deepseek-chat',
    })
    expect(actions.setOverlayModel).toHaveBeenNthCalledWith(2, {
      provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high',
    })
    expect(actions.setBackgroundModel).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high',
    })
    expect(actions.setSelectionEnabled).toHaveBeenCalledWith(false)
    expect(actions.setMillifractionEnabled).toHaveBeenCalledWith(false)
    expect(screen.getByRole('switch', { name: 'Use millifraction coordinates' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose image' }).disabled).toBe(false)
  })

  it('shows the macOS-only banner and disables controls on Windows', () => {
    mount({ supported: false })
    expect(screen.getByRole('status').textContent).toBe('The floating ball is available only on macOS.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose image' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Floating-ball Agent' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: 'Enable the selection toolbar' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: 'Use millifraction coordinates' }).disabled).toBe(true)
    cleanup()
    mount({ busy: true })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose image' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Floating-ball Agent' }).disabled).toBe(true)
  })

  it('surfaces a rejected avatar and an unavailable Desktop bridge', () => {
    mount({ avatarError: 'too-large' })
    expect(screen.getByRole('alert').textContent).toBe('The image is larger than 2 MB.')
    cleanup()
    mount({ avatarError: 'invalid-type', avatarUrl: '' })
    expect(screen.getByRole('alert').textContent).toBe('Choose a GIF, PNG, or WebP image.')
    cleanup()
    mount({ status: 'unavailable', catalog: undefined, avatarUrl: '' })
    expect(screen.getByRole('alert').textContent).toBe(
      'This window cannot read Desktop floating-ball settings.',
    )
  })

  it('retries a failed load and shows the empty-catalog line', () => {
    const actions = mount({ status: 'error', error: 'catalog down', catalog: undefined })
    expect(screen.getByRole('alert').textContent).toBe('Could not load floating-ball settings. catalog down')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(actions.load).toHaveBeenCalledTimes(2)
    cleanup()
    mount({ status: 'error', error: null, catalog: undefined })
    expect(screen.getByRole('alert').textContent).toBe('Could not load floating-ball settings. ')
    cleanup()
    mount({ catalog: { groups: [] } })
    expect(screen.getAllByText('No models available.')).toHaveLength(2)
    cleanup()
    mount({ catalog: undefined })
    expect(screen.getAllByText('No models available.')).toHaveLength(2)
  })

  it('selects Default effort when the catalog omits a default', () => {
    const actions = mount({
      overlay: { provider: 'deepseek-official', model: 'thinker', reasoningEffort: 'high' },
      catalog: {
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{
            id: 'thinker',
            name: 'Thinker',
            reasoning: { efforts: [{ id: 'high', name: 'High' }] },
          }],
        }],
      },
    })
    const overlay = screen.getByRole('button', { name: 'Floating-ball Agent' })
    expect(overlay.textContent).toContain('Thinker')
    expect(overlay.textContent).toContain('High')
    fireEvent.click(overlay)
    const thinker = screen.getByRole('menuitem', { name: 'Thinker' })
    fireEvent.mouseEnter(thinker.parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Default' }))
    expect(actions.setOverlayModel).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'thinker',
    })
  })
})

describe('OrbModelPicker', () => {
  const catalog = READY.catalog!

  it('falls back to the stored model id and a raw effort token', () => {
    render(
      <OrbModelPicker
        label="Agent"
        catalog={{
          groups: [{
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [{
              id: 'deepseek-flash',
              name: 'DeepSeek-V41-Flash',
              reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' },
            }],
          }],
        }}
        current={{ provider: 'other', model: 'vanished', reasoningEffort: 'mystery' }}
        disabled={false}
        emptyLabel="empty"
        defaultEffortLabel="Default"
        onSelect={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain('vanished')
    cleanup()
    render(
      <OrbModelPicker
        label="Agent"
        catalog={catalog}
        current={{ provider: 'deepseek-official', model: 'missing' }}
        disabled={false}
        emptyLabel="empty"
        defaultEffortLabel="Default"
        onSelect={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain('missing')
    cleanup()
    render(
      <OrbModelPicker
        label="Agent"
        catalog={catalog}
        current={{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'mystery' }}
        disabled={false}
        emptyLabel="empty"
        defaultEffortLabel="Default"
        onSelect={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain('mystery')
  })

  it('closes an open menu when the control becomes disabled and keeps Default selected', () => {
    const onSelect = vi.fn()
    const view = render(
      <OrbModelPicker
        label="Agent"
        catalog={{
          groups: [{
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [{
              id: 'thinker',
              name: 'Thinker',
              reasoning: { efforts: [{ id: 'high', name: 'High' }] },
            }],
          }],
        }}
        current={{ provider: 'deepseek-official', model: 'thinker' }}
        disabled={false}
        emptyLabel="empty"
        defaultEffortLabel="Default"
        onSelect={onSelect}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Agent' })
    expect(trigger.textContent).toContain('Default')
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Thinker' }).parentElement as HTMLElement)
    expect(screen.getByRole('menuitem', { name: 'Default' })).toBeDefined()
    view.rerender(
      <OrbModelPicker
        label="Agent"
        catalog={catalog}
        current={{ provider: 'deepseek-official', model: 'deepseek-flash' }}
        disabled
        emptyLabel="empty"
        defaultEffortLabel="Default"
        onSelect={onSelect}
      />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    const disabled = screen.getByRole<HTMLButtonElement>('button', { name: 'Agent' })
    expect(disabled.disabled).toBe(true)
    fireEvent.click(disabled)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
