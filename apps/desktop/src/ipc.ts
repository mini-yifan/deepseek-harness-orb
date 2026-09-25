/** Typed preload operations exposed only by the Electron shell. */

import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'
import type { TccRight, TccStatus } from './tcc.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  boot: 'dsh-desktop:boot',
  enterWorkspace: 'dsh-desktop:enter-workspace',
  bootFailed: 'dsh-desktop:boot-failed',
  browserAcquire: 'dsh-desktop:browser-acquire',
  browserRelease: 'dsh-desktop:browser-release',
  browserOpenRequested: 'dsh-desktop:browser-open-requested',
  directoryPick: 'dsh-desktop:directory-pick',
  localeBootstrap: 'dsh-desktop:locale-bootstrap',
  localeChanged: 'dsh-desktop:locale-changed',
  updatesStatus: 'dsh-desktop:updates-status',
  updatesOpen: 'dsh-desktop:updates-open',
  updatesPresentation: 'dsh-desktop:updates-presentation',
  nativeThemeSet: 'dsh-desktop:native-theme-set',
  windowFullscreen: 'dsh-desktop:window-fullscreen',
  windowsAppearance: 'dsh-desktop:windows-appearance',
  windowsMenu: 'dsh-desktop:windows-menu',
  floatingMove: 'dsh-desktop:floating-move',
  floatingClamp: 'dsh-desktop:floating-clamp',
  floatingUnsnap: 'dsh-desktop:floating-unsnap',
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
  floatingEditing: 'dsh-desktop:floating-editing',
  floatingRestoreFront: 'dsh-desktop:floating-restore-front',
  floatingAvatarGet: 'dsh-desktop:floating-avatar-get',
  floatingAvatar: 'dsh-desktop:floating-avatar',
  floatingTccGet: 'dsh-desktop:floating-tcc-get',
  floatingTccOpen: 'dsh-desktop:floating-tcc-open',
  floatingTccRelaunch: 'dsh-desktop:floating-tcc-relaunch',
  floatingTcc: 'dsh-desktop:floating-tcc',
  floatingCreateSession: 'dsh-desktop:floating-create-session',
  floatingLocale: 'dsh-desktop:floating-locale',
  backendStatus: 'dsh-desktop:backend-status',
  backendState: 'dsh-desktop:backend-state',
  selectionPrompt: 'dsh-desktop:selection-prompt',
  selectionAttach: 'dsh-desktop:selection-attach',
  selectionSearch: 'dsh-desktop:selection-search',
  selectionTranslate: 'dsh-desktop:selection-translate',
  selectionSetLanguage: 'dsh-desktop:selection-set-language',
  selectionInteract: 'dsh-desktop:selection-interact',
  selectionSetContentSize: 'dsh-desktop:selection-set-content-size',
  selectionState: 'dsh-desktop:selection-state',
  orbSupported: 'dsh-desktop:orb-supported',
  orbSnapshot: 'dsh-desktop:orb-snapshot',
  orbPickAvatar: 'dsh-desktop:orb-pick-avatar',
  orbRestoreAvatar: 'dsh-desktop:orb-restore-avatar',
  orbSetOverlayModel: 'dsh-desktop:orb-set-overlay-model',
  orbSetBackgroundModel: 'dsh-desktop:orb-set-background-model',
  orbSetSelectionEnabled: 'dsh-desktop:orb-set-selection-enabled',
  orbSetMillifractionEnabled: 'dsh-desktop:orb-set-millifraction-enabled',
  orbOpenTcc: 'dsh-desktop:orb-open-tcc',
} as const

/** Floating-ball shell bridge. The product window uses {@link DshDesktopProductApi}. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  /** Shell dictionary for the floating ball and the selection toolbar. */
  locale(): Promise<{ readonly id: 'en' | 'zh-CN'; readonly messages: Readonly<Record<string, string>> }>
  readonly backend: {
    status(): Promise<{ readonly phase: 'starting' | 'ready' | 'error'; readonly message?: string }>
    subscribe(listener: (state: { readonly phase: 'starting' | 'ready' | 'error'; readonly message?: string }) => void): () => void
  }
  readonly floating: {
    setExpanded(expanded: boolean): Promise<unknown>
    clamp(canDock?: boolean): Promise<unknown>
    unsnap(): Promise<unknown>
    move(x: number, y: number, canDock?: boolean): Promise<unknown>
    orbWorkspacePath(): Promise<unknown>
    setSessionRunning(running: boolean): Promise<unknown>
    setTextEditing(editing: boolean): Promise<unknown>
    restoreFrontApp(): Promise<unknown>
    avatarUrl(): Promise<unknown>
    overlayModel(): Promise<unknown>
    overlayPermission(): Promise<unknown>
    setOverlayPermission(preset: string, sessionId?: string): Promise<unknown>
    tccStatus(): Promise<unknown>
    openTcc(right: string): Promise<unknown>
    relaunch(): Promise<unknown>
  }
  readonly selection: {
    search(): Promise<unknown>
    translate(): Promise<unknown>
    sendToAgent(): Promise<unknown>
    setLanguage(language: string): Promise<unknown>
    interact(): Promise<unknown>
    setContentSize(size: { width: number; height: number }): Promise<unknown>
  }
}

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Current floating-ball preferences the Settings page reads. */
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

/** Result of picking a custom ball image. */
export type OrbAvatarWriteResult =
  | { readonly ok: true; readonly snapshot: OrbSettingsSnapshot }
  | { readonly ok: false; readonly error: OrbAvatarWriteError }

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface DshDesktopProductApi {
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly updates: {
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
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

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'dsh-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}
