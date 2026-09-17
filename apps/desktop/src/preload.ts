/** Context-isolated renderer bridge for desktop package and update operations. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopApi, type DesktopUpdateState, type SelectionAttachPayload, type SelectionPromptPayload, type SelectionToolbarState } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'
import type { OrbPermissionPreset } from './orb-permission.ts'

const api: DshDesktopApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as Promise<ReturnType<DshDesktopApi['locale']> extends Promise<infer T> ? T : never>,
  plugins: {
    list: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsList) as Promise<ReturnType<DshDesktopApi['plugins']['list']> extends Promise<infer T> ? T : never>,
    add: spec => ipcRenderer.invoke(DESKTOP_IPC.pluginsAdd, spec) as Promise<void>,
    remove: name => ipcRenderer.invoke(DESKTOP_IPC.pluginsRemove, name) as Promise<void>,
    toggle: (name, enabled) => ipcRenderer.invoke(DESKTOP_IPC.pluginsToggle, name, enabled) as Promise<void>,
    disableAll: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
    update: (name, version) => ipcRenderer.invoke(DESKTOP_IPC.pluginsUpdate, name, version) as Promise<void>,
  },
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopApi['backend']['status']>,
    retry: () => ipcRenderer.invoke(DESKTOP_IPC.backendRetry) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  updates: {
    check: () => ipcRenderer.invoke(DESKTOP_IPC.updatesCheck) as Promise<DesktopUpdateState>,
    install: () => ipcRenderer.invoke(DESKTOP_IPC.updatesInstall) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.updatesState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.updatesState, handle) }
    },
  },
  floating: {
    move: (x, y) => ipcRenderer.invoke(DESKTOP_IPC.floatingMove, x, y) as Promise<void>,
    clamp: () => ipcRenderer.invoke(DESKTOP_IPC.floatingClamp) as Promise<void>,
    setExpanded: expanded => ipcRenderer.invoke(DESKTOP_IPC.floatingSetExpanded, expanded) as ReturnType<DshDesktopApi['floating']['setExpanded']>,
    sessionId: () => ipcRenderer.invoke(DESKTOP_IPC.floatingSessionGet) as Promise<string | undefined>,
    setSessionId: sessionId => ipcRenderer.invoke(DESKTOP_IPC.floatingSessionSet, sessionId) as Promise<void>,
    overlayModel: () => ipcRenderer.invoke(DESKTOP_IPC.floatingOverlayModelGet) as Promise<OrbAgentModelSelection>,
    onOverlayModel(listener) {
      const handle = (_event: Electron.IpcRendererEvent, selection: OrbAgentModelSelection): void => {
        listener(selection)
      }
      ipcRenderer.on(DESKTOP_IPC.floatingOverlayModel, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.floatingOverlayModel, handle) }
    },
    overlayPermission: () => ipcRenderer.invoke(DESKTOP_IPC.floatingOverlayPermissionGet) as Promise<OrbPermissionPreset>,
    setOverlayPermission: (preset, sessionId) => (
      sessionId === undefined
        ? ipcRenderer.invoke(DESKTOP_IPC.floatingOverlayPermissionSet, preset)
        : ipcRenderer.invoke(DESKTOP_IPC.floatingOverlayPermissionSet, preset, sessionId)
    ) as Promise<void>,
    orbWorkspacePath: () => ipcRenderer.invoke(DESKTOP_IPC.floatingOrbWorkspace) as Promise<string>,
    focusMain: () => ipcRenderer.invoke(DESKTOP_IPC.floatingFocusMain) as Promise<void>,
    quit: () => ipcRenderer.invoke(DESKTOP_IPC.floatingQuit) as Promise<void>,
    setSessionRunning: running => ipcRenderer.invoke(DESKTOP_IPC.floatingRunning, running) as Promise<void>,
    onSelectionPrompt(listener) {
      const handle = (_event: Electron.IpcRendererEvent, payload: SelectionPromptPayload): void => {
        listener(payload)
      }
      ipcRenderer.on(DESKTOP_IPC.selectionPrompt, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.selectionPrompt, handle) }
    },
    onSelectionAttach(listener) {
      const handle = (_event: Electron.IpcRendererEvent, payload: SelectionAttachPayload): void => {
        listener(payload)
      }
      ipcRenderer.on(DESKTOP_IPC.selectionAttach, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.selectionAttach, handle) }
    },
  },
  selection: {
    search: () => ipcRenderer.invoke(DESKTOP_IPC.selectionSearch) as Promise<void>,
    translate: () => ipcRenderer.invoke(DESKTOP_IPC.selectionTranslate) as Promise<void>,
    sendToAgent: () => ipcRenderer.invoke(DESKTOP_IPC.selectionAttach) as Promise<void>,
    setLanguage: language => ipcRenderer.invoke(DESKTOP_IPC.selectionSetLanguage, language) as Promise<void>,
    interact: () => ipcRenderer.invoke(DESKTOP_IPC.selectionInteract) as Promise<void>,
    setContentSize: size => ipcRenderer.invoke(DESKTOP_IPC.selectionSetContentSize, size) as Promise<{ menuAbove: boolean }>,
    onState(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: SelectionToolbarState): void => {
        listener(state)
      }
      ipcRenderer.on(DESKTOP_IPC.selectionState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.selectionState, handle) }
    },
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)
