/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { FloatingExpandState } from './floating-window.ts'
import type { SelectionTranslateLanguage } from './selection-prompt.ts'

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
  floatingOrbWorkspace: 'dsh-desktop:floating-orb-workspace',
  floatingFocusMain: 'dsh-desktop:floating-focus-main',
  floatingQuit: 'dsh-desktop:floating-quit',
  floatingRunning: 'dsh-desktop:floating-running',
  selectionPrompt: 'dsh-desktop:selection-prompt',
  selectionSearch: 'dsh-desktop:selection-search',
  selectionTranslate: 'dsh-desktop:selection-translate',
  selectionExplain: 'dsh-desktop:selection-explain',
  selectionSetLanguage: 'dsh-desktop:selection-set-language',
  selectionState: 'dsh-desktop:selection-state',
  selectionInteract: 'dsh-desktop:selection-interact',
  selectionSetContentSize: 'dsh-desktop:selection-set-content-size',
} as const

/** User-message text the overlay renderer prompts onto the Computer Use session. */
export interface SelectionPromptPayload {
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
    orbWorkspacePath(): Promise<string>
    focusMain(): Promise<void>
    quit(): Promise<void>
    setSessionRunning(running: boolean): Promise<void>
    onSelectionPrompt(listener: (payload: SelectionPromptPayload) => void): () => void
  }
  readonly selection: {
    search(): Promise<void>
    translate(): Promise<void>
    explain(): Promise<void>
    setLanguage(language: SelectionTranslateLanguage): Promise<void>
    interact(): Promise<void>
    setContentSize(size: { width: number; height: number }): Promise<{ menuAbove: boolean }>
    onState(listener: (state: SelectionToolbarState) => void): () => void
  }
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
