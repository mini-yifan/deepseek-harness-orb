// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
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
    fireEvent.click(screen.getAllByLabelText('DeepSeek-V3.2')[0]!)
    fireEvent.click(screen.getAllByLabelText('High')[0]!)
    fireEvent.click(screen.getAllByLabelText('High')[1]!)
    fireEvent.click(screen.getByRole('switch', { name: 'Enable the selection toolbar' }))
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
  })

  it('shows the macOS-only banner and disables controls on Windows', () => {
    mount({ supported: false })
    expect(screen.getByRole('status').textContent).toBe('The floating ball is available only on macOS.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose image' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: 'Enable the selection toolbar' }).disabled).toBe(true)
    cleanup()
    mount({ busy: true })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose image' }).disabled).toBe(true)
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
    fireEvent.click(screen.getAllByLabelText('Default')[0]!)
    expect(actions.setOverlayModel).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'thinker',
    })
  })
})
