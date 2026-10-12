import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.clearAllMocks(); vi.resetModules() })

it('exposes overlay expand, drag signals, dsh_orb workspace, and selection IPC', async () => {
  await import('../src/preload.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopApi
  expect(api.floating).toMatchObject({
    setExpanded: expect.any(Function),
    unsnap: expect.any(Function),
    dragPress: expect.any(Function),
    dragBegin: expect.any(Function),
    dragMove: expect.any(Function),
    dragEnd: expect.any(Function),
    orbWorkspacePath: expect.any(Function),
    setSessionRunning: expect.any(Function),
    setTextEditing: expect.any(Function),
    restoreFrontApp: expect.any(Function),
    overlayModel: expect.any(Function),
    onOverlayModel: expect.any(Function),
    avatarUrl: expect.any(Function),
    onAvatar: expect.any(Function),
    overlayPermission: expect.any(Function),
    setOverlayPermission: expect.any(Function),
    tccStatus: expect.any(Function),
    openTcc: expect.any(Function),
    relaunch: expect.any(Function),
    onTccStatus: expect.any(Function),
    onSelectionPrompt: expect.any(Function),
    onSelectionAttach: expect.any(Function),
    onCreateSession: expect.any(Function),
  })
  expect(api.backend).toMatchObject({
    status: expect.any(Function),
    subscribe: expect.any(Function),
  })
  expect(api.selection).toMatchObject({
    search: expect.any(Function),
    translate: expect.any(Function),
    sendToAgent: expect.any(Function),
    setLanguage: expect.any(Function),
    interact: expect.any(Function),
    setContentSize: expect.any(Function),
    onState: expect.any(Function),
  })
  expect(api.floating).not.toHaveProperty('toggle')
  expect(api.floating).not.toHaveProperty('dock')
  await api.locale()
  await api.floating.setExpanded(true)
  await api.floating.unsnap()
  await api.floating.dragPress()
  await api.floating.dragBegin()
  await api.floating.dragMove(false)
  await api.floating.dragEnd(false)
  await api.floating.orbWorkspacePath()
  await api.floating.setSessionRunning(true)
  await api.floating.setTextEditing(true)
  await api.floating.restoreFrontApp()
  await api.floating.avatarUrl()
  await api.floating.overlayModel()
  await api.floating.overlayPermission()
  await api.floating.setOverlayPermission('workspace-write')
  await api.floating.tccStatus()
  await api.floating.openTcc('screen')
  await api.floating.relaunch()
  await api.selection.search()
  await api.selection.interact()
  await api.selection.setContentSize({ width: 280, height: 120 })
  await api.backend.status()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.floatingLocale],
    [DESKTOP_IPC.floatingSetExpanded, true],
    [DESKTOP_IPC.floatingUnsnap],
    [DESKTOP_IPC.floatingDragPress],
    [DESKTOP_IPC.floatingDragBegin],
    [DESKTOP_IPC.floatingDragMove, false],
    [DESKTOP_IPC.floatingDragEnd, false],
    [DESKTOP_IPC.floatingOrbWorkspace],
    [DESKTOP_IPC.floatingRunning, true],
    [DESKTOP_IPC.floatingEditing, true],
    [DESKTOP_IPC.floatingRestoreFront],
    [DESKTOP_IPC.floatingAvatarGet],
    [DESKTOP_IPC.floatingOverlayModelGet],
    [DESKTOP_IPC.floatingOverlayPermissionGet],
    [DESKTOP_IPC.floatingOverlayPermissionSet, 'workspace-write', undefined],
    [DESKTOP_IPC.floatingTccGet],
    [DESKTOP_IPC.floatingTccOpen, 'screen'],
    [DESKTOP_IPC.floatingTccRelaunch],
    [DESKTOP_IPC.selectionSearch],
    [DESKTOP_IPC.selectionInteract],
    [DESKTOP_IPC.selectionSetContentSize, { width: 280, height: 120 }],
    [DESKTOP_IPC.backendStatus],
  ])
})
