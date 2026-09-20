/**
 * Floating-ball Settings controller: Desktop profile preferences plus the
 * Host model catalog. Writes go through `window.dshDesktop` immediately;
 * the catalog is Host RPC and never stored in Host settings.yaml.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  readDesktopAppApi,
  type DshDesktopAppApi,
  type OrbAgentModelSelection,
  type OrbAvatarWriteError,
  type OrbSettingsSnapshot,
  type TccRight,
  type TccStatus,
} from './desktop-api.ts'

/** Host-generation catalog fields the overlay model pickers read. */
export interface OrbModelCatalog {
  readonly groups: readonly OrbModelProviderGroup[]
}

/** One provider and its successfully loaded models. */
export interface OrbModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly OrbCatalogModel[]
}

/** One catalog model, with optional reasoning efforts. */
export interface OrbCatalogModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string }[]
    readonly defaultEffort?: string
  }
}

/** Page snapshot. */
export interface OrbSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** False on Windows; the page stays visible with controls disabled. */
  supported: boolean
  avatarUrl: string
  avatarError: Exclude<OrbAvatarWriteError, 'cancelled'> | null
  overlay: OrbAgentModelSelection
  background: OrbAgentModelSelection
  selectionEnabled: boolean
  millifractionEnabled: boolean
  tcc: TccStatus
  catalog: OrbModelCatalog | undefined
  busy: boolean
}

const IDLE: OrbSettingsState = {
  status: 'idle',
  error: null,
  supported: false,
  avatarUrl: '',
  avatarError: null,
  overlay: { provider: '', model: '' },
  background: { provider: '', model: '' },
  selectionEnabled: true,
  millifractionEnabled: true,
  tcc: { applicable: false, appName: '', screen: 'granted', accessibility: 'granted' },
  catalog: undefined,
  busy: false,
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Registration-side business face for the floating-ball Settings section. */
export interface OrbSettingsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useOrbSettings. */
    orbSettings: SnapshotStore<OrbSettingsState>
  }
  /** Read Desktop snapshot and Host catalog; called once when the section first renders. */
  load: () => Promise<void>
  /** Open the native file dialog and install a custom ball image. */
  pickAvatar: () => Promise<void>
  /** Delete the custom image so the packaged GIF is served again. */
  restoreAvatar: () => Promise<void>
  /** Persist the overlay Computer Use model. */
  setOverlayModel: (selection: OrbAgentModelSelection) => Promise<void>
  /** Persist the background `code_agent` model. */
  setBackgroundModel: (selection: OrbAgentModelSelection) => Promise<void>
  /** Persist selection-toolbar enablement. */
  setSelectionEnabled: (enabled: boolean) => Promise<void>
  /** Confirm, then persist millifraction-coordinates enablement and create a new overlay chat. */
  setMillifractionEnabled: (enabled: boolean) => Promise<void>
  /** Open the matching macOS System Settings pane for Screen Recording or Accessibility. */
  openTcc: (right: TccRight) => Promise<void>
}

/** Loads Desktop orb preferences and the Host model catalog. */
export class OrbSettingsController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<OrbSettingsState> = createSnapshotStore(IDLE)

  /**
   * @param ctx - browser plugin context; `remote.session` supplies the catalog.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Read the Desktop snapshot and Host catalog.
   * @returns after the page snapshot is published.
   */
  async load(): Promise<void> {
    const api = readDesktopAppApi()
    if (api === undefined) {
      this.store.set({ ...IDLE, status: 'unavailable' })
      return
    }
    this.store.set({ ...this.store.getSnapshot(), status: 'loading', error: null })
    try {
      const [snapshot, catalog] = await Promise.all([api.orb.snapshot(), this.readCatalog()])
      this.publishSnapshot(snapshot, catalog, null)
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  /**
   * Open the native picker and persist a custom ball image.
   * @returns after the snapshot reflects the pick, a cancellation, or a rejected file.
   */
  async pickAvatar(): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    this.store.set({ ...this.store.getSnapshot(), busy: true, avatarError: null })
    try {
      const result = await api.orb.pickAvatar()
      if (!result.ok) {
        this.store.set({
          ...this.store.getSnapshot(),
          busy: false,
          avatarError: result.error === 'cancelled' ? null : result.error,
        })
        return
      }
      this.applySnapshot(result.snapshot)
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  /**
   * Restore the packaged ball GIF.
   * @returns after the snapshot reflects the packaged image.
   */
  async restoreAvatar(): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    this.store.set({ ...this.store.getSnapshot(), busy: true, avatarError: null })
    try {
      this.applySnapshot(await api.orb.restoreAvatar())
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  /**
   * Persist the overlay Computer Use selection.
   * @param selection - provider, model, and optional reasoning effort.
   * @returns after Desktop writes the profile JSON.
   */
  async setOverlayModel(selection: OrbAgentModelSelection): Promise<void> {
    await this.writeModel('overlay', selection)
  }

  /**
   * Persist the background `code_agent` selection.
   * @param selection - provider, model, and optional reasoning effort.
   * @returns after Desktop writes the profile JSON.
   */
  async setBackgroundModel(selection: OrbAgentModelSelection): Promise<void> {
    await this.writeModel('background', selection)
  }

  /**
   * Persist selection-toolbar enablement and start or stop the helper.
   * @param enabled - whether the toolbar should read selections.
   * @returns after Desktop writes the profile JSON.
   */
  async setSelectionEnabled(enabled: boolean): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    this.store.set({ ...this.store.getSnapshot(), selectionEnabled: enabled, busy: true })
    try {
      await api.orb.setSelectionEnabled(enabled)
      this.store.set({ ...this.store.getSnapshot(), busy: false })
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  /**
   * Persist millifraction-coordinates enablement only after native confirm.
   * Does not set busy or flip the switch until Electron returns a non-cancelled snapshot.
   * @param enabled - whether new overlay chats should use 0–1000 millifraction.
   * @returns after Desktop confirms or cancels.
   */
  async setMillifractionEnabled(enabled: boolean): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    try {
      const result = await api.orb.setMillifractionEnabled(enabled)
      if (result.cancelled) return
      this.store.set({
        ...this.store.getSnapshot(),
        millifractionEnabled: result.snapshot.millifractionEnabled,
      })
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  /**
   * Open Screen Recording or Accessibility in System Settings and refresh status.
   * @param right - the TCC pane to open.
   * @returns after Desktop writes the snapshot.
   */
  async openTcc(right: TccRight): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    this.store.set({ ...this.store.getSnapshot(), busy: true })
    try {
      this.applySnapshot(await api.orb.openTcc(right))
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  private requireApi(): DshDesktopAppApi | undefined {
    const api = readDesktopAppApi()
    if (api === undefined) {
      this.store.set({ ...this.store.getSnapshot(), status: 'unavailable' })
    }
    return api
  }

  private applySnapshot(snapshot: OrbSettingsSnapshot): void {
    const current = this.store.getSnapshot()
    this.store.set({
      ...current,
      status: 'ready',
      error: null,
      busy: false,
      avatarError: null,
      supported: snapshot.supported,
      avatarUrl: snapshot.avatarUrl,
      overlay: snapshot.overlay,
      background: snapshot.background,
      selectionEnabled: snapshot.selectionEnabled,
      millifractionEnabled: snapshot.millifractionEnabled,
      tcc: snapshot.tcc,
    })
  }

  private publishSnapshot(
    snapshot: OrbSettingsSnapshot,
    catalog: OrbModelCatalog | undefined,
    error: string | null,
  ): void {
    this.store.set({
      status: 'ready',
      error,
      supported: snapshot.supported,
      avatarUrl: snapshot.avatarUrl,
      avatarError: null,
      overlay: snapshot.overlay,
      background: snapshot.background,
      selectionEnabled: snapshot.selectionEnabled,
      millifractionEnabled: snapshot.millifractionEnabled,
      tcc: snapshot.tcc,
      catalog,
      busy: false,
    })
  }

  private async writeModel(
    side: 'overlay' | 'background',
    selection: OrbAgentModelSelection,
  ): Promise<void> {
    const api = this.requireApi()
    if (api === undefined) return
    this.store.set({ ...this.store.getSnapshot(), [side]: selection, busy: true })
    try {
      if (side === 'overlay') await api.orb.setOverlayModel(selection)
      else await api.orb.setBackgroundModel(selection)
      this.store.set({ ...this.store.getSnapshot(), busy: false })
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'error',
        error: errorMessage(error),
        busy: false,
      })
    }
  }

  private async readCatalog(): Promise<OrbModelCatalog | undefined> {
    const response = await this.ctx.remote.session.modelCatalog()
    if (!response.ok) return undefined
    return { groups: response.value.groups }
  }
}
