/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { FloatingExpandState } from './floating-window.ts'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'
import type { OrbPermissionPreset } from './orb-permission.ts'
import type { SelectionTranslateLanguage } from './selection-prompt.ts'
import type { TccRight, TccStatus } from './tcc.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  pluginsToggle: 'dsh-desktop:plugins-toggle',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  backendState: 'dsh-desktop:backend-state',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
  floatingMove: 'dsh-desktop:floating-move',
  floatingClamp: 'dsh-desktop:floating-clamp',
  floatingSetExpanded: 'dsh-desktop:floating-set-expanded',
  floatingSessionGet: 'dsh-desktop:floating-session-get',
  floatingSessionSet: 'dsh-desktop:floating-session-set',
  floatingOverlayModelGet: 'dsh-desktop:floating-overlay-model-get',
  floatingOverlayModel: 'dsh-desktop:floating-overlay-model',
  floatingOverlayPermissionGet: 'dsh-desktop:floating-overlay-permission-get',
  floatingOverlayPermissionSet: 'dsh-desktop:floating-overlay-permission-set',
  floatingOrbWorkspace: 'dsh-desktop:floating-orb-workspace',
  floatingFocusMain: 'dsh-desktop:floating-focus-main',
  floatingQuit: 'dsh-desktop:floating-quit',
  floatingRunning: 'dsh-desktop:floating-running',
  floatingAvatarGet: 'dsh-desktop:floating-avatar-get',
  floatingAvatar: 'dsh-desktop:floating-avatar',
  floatingTccGet: 'dsh-desktop:floating-tcc-get',
  floatingTccOpen: 'dsh-desktop:floating-tcc-open',
  floatingTccRelaunch: 'dsh-desktop:floating-tcc-relaunch',
  floatingTcc: 'dsh-desktop:floating-tcc',
  orbSupported: 'dsh-desktop:orb-supported',
  orbSnapshot: 'dsh-desktop:orb-snapshot',
  orbPickAvatar: 'dsh-desktop:orb-pick-avatar',
  orbRestoreAvatar: 'dsh-desktop:orb-restore-avatar',
  orbSetOverlayModel: 'dsh-desktop:orb-set-overlay-model',
  orbSetBackgroundModel: 'dsh-desktop:orb-set-background-model',
  orbSetSelectionEnabled: 'dsh-desktop:orb-set-selection-enabled',
  orbSetMillifractionEnabled: 'dsh-desktop:orb-set-millifraction-enabled',
  orbOpenTcc: 'dsh-desktop:orb-open-tcc',
  floatingCreateSession: 'dsh-desktop:floating-create-session',
  selectionPrompt: 'dsh-desktop:selection-prompt',
  selectionAttach: 'dsh-desktop:selection-attach',
  selectionSearch: 'dsh-desktop:selection-search',
  selectionTranslate: 'dsh-desktop:selection-translate',
  selectionSetLanguage: 'dsh-desktop:selection-set-language',
  selectionState: 'dsh-desktop:selection-state',
  selectionInteract: 'dsh-desktop:selection-interact',
  selectionSetContentSize: 'dsh-desktop:selection-set-content-size',
} as const

/** User-message text the overlay renderer prompts onto the Computer Use session. */
export interface SelectionPromptPayload {
  readonly text: string
}

/** Selected text the overlay renderer attaches to the composer without prompting. */
export interface SelectionAttachPayload {
  readonly text: string
}

/** Labels and current language pushed to the selection-toolbar renderer. */
export interface SelectionToolbarState {
  readonly language: 'zh' | 'en'
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    disableAll(): Promise<void>
  }
  readonly backend: {
    status(): Promise<DesktopBackendState>
    retry(): Promise<void>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
  readonly floating: {
    move(x: number, y: number): Promise<void>
    clamp(): Promise<void>
    setExpanded(expanded: boolean): Promise<FloatingExpandState>
    sessionId(): Promise<string | undefined>
    setSessionId(sessionId: string): Promise<void>
    overlayModel(): Promise<OrbAgentModelSelection>
    onOverlayModel(listener: (selection: OrbAgentModelSelection) => void): () => void
    overlayPermission(): Promise<OrbPermissionPreset>
    setOverlayPermission(preset: OrbPermissionPreset, sessionId?: string): Promise<void>
    orbWorkspacePath(): Promise<string>
    focusMain(): Promise<void>
    quit(): Promise<void>
    setSessionRunning(running: boolean): Promise<void>
    avatarUrl(): Promise<string>
    onAvatar(listener: (url: string) => void): () => void
    onSelectionPrompt(listener: (payload: SelectionPromptPayload) => void): () => void
    onSelectionAttach(listener: (payload: SelectionAttachPayload) => void): () => void
    onCreateSession(listener: () => void): () => void
    tccStatus(): Promise<TccStatus>
    openTcc(right: TccRight): Promise<TccStatus>
    relaunch(): Promise<void>
    onTccStatus(listener: (status: TccStatus) => void): () => void
  }
  readonly selection: {
    search(): Promise<void>
    translate(): Promise<void>
    sendToAgent(): Promise<void>
    setLanguage(language: SelectionTranslateLanguage): Promise<void>
    interact(): Promise<void>
    setContentSize(size: { width: number; height: number }): Promise<{ menuAbove: boolean }>
    onState(listener: (state: SelectionToolbarState) => void): () => void
  }
}

/** Current floating-ball preferences the main-window Settings page reads. */
export interface OrbSettingsSnapshot {
  readonly supported: boolean
  readonly avatarUrl: string
  readonly overlay: OrbAgentModelSelection
  readonly background: OrbAgentModelSelection
  readonly selectionEnabled: boolean
  readonly millifractionEnabled: boolean
  readonly tcc: TccStatus
}

/** Result of confirming a millifraction-coordinates default change. */
export type OrbMillifractionWriteResult =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly snapshot: OrbSettingsSnapshot }

/** Why a custom ball image was not installed. */
export type OrbAvatarWriteError = 'cancelled' | 'too-large' | 'invalid-type'

/** Result of picking or restoring the ball image. */
export type OrbAvatarWriteResult =
  | { readonly ok: true; readonly snapshot: OrbSettingsSnapshot }
  | { readonly ok: false; readonly error: OrbAvatarWriteError }

/** Main-window bridge for floating-ball Settings; shell documents never receive it. */
export interface DshDesktopAppApi {
  readonly protocolVersion: 1
  readonly orb: {
    supported(): Promise<boolean>
    snapshot(): Promise<OrbSettingsSnapshot>
    pickAvatar(): Promise<OrbAvatarWriteResult>
    restoreAvatar(): Promise<OrbSettingsSnapshot>
    setOverlayModel(selection: OrbAgentModelSelection): Promise<void>
    setBackgroundModel(selection: OrbAgentModelSelection): Promise<void>
    setSelectionEnabled(enabled: boolean): Promise<void>
    setMillifractionEnabled(enabled: boolean): Promise<OrbMillifractionWriteResult>
    openTcc(right: TccRight): Promise<OrbSettingsSnapshot>
  }
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
