/** Startup controls for shell documents; application documents receive floating-ball Settings. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_IPC,
  type DshDesktopAppApi,
  type DshDesktopStartupApi,
  type OrbAvatarWriteResult,
  type OrbMillifractionWriteResult,
  type OrbSettingsSnapshot,
} from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

const app: DshDesktopAppApi = {
  protocolVersion: 1,
  orb: {
    supported: () => ipcRenderer.invoke(DESKTOP_IPC.orbSupported) as Promise<boolean>,
    snapshot: () => ipcRenderer.invoke(DESKTOP_IPC.orbSnapshot) as Promise<OrbSettingsSnapshot>,
    pickAvatar: () => ipcRenderer.invoke(DESKTOP_IPC.orbPickAvatar) as Promise<OrbAvatarWriteResult>,
    restoreAvatar: () => ipcRenderer.invoke(DESKTOP_IPC.orbRestoreAvatar) as Promise<OrbSettingsSnapshot>,
    setOverlayModel: (selection: OrbAgentModelSelection) => (
      ipcRenderer.invoke(DESKTOP_IPC.orbSetOverlayModel, selection) as Promise<void>
    ),
    setBackgroundModel: (selection: OrbAgentModelSelection) => (
      ipcRenderer.invoke(DESKTOP_IPC.orbSetBackgroundModel, selection) as Promise<void>
    ),
    setSelectionEnabled: (enabled: boolean) => (
      ipcRenderer.invoke(DESKTOP_IPC.orbSetSelectionEnabled, enabled) as Promise<void>
    ),
    setMillifractionEnabled: (enabled: boolean) => (
      ipcRenderer.invoke(DESKTOP_IPC.orbSetMillifractionEnabled, enabled) as Promise<OrbMillifractionWriteResult>
    ),
    openTcc: right => ipcRenderer.invoke(DESKTOP_IPC.orbOpenTcc, right) as Promise<OrbSettingsSnapshot>,
  },
}

const api = location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup
  : location.protocol === 'dsh-app:' && location.hostname === 'app'
    ? app
    : { protocolVersion: 1 as const }

contextBridge.exposeInMainWorld('dshDesktop', api)
