import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.clearAllMocks(); vi.resetModules() })

it('exposes overlay expand, clamp, dsh_orb workspace, and selection IPC', async () => {
  await import('../src/preload.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopApi
  expect(api.floating).toMatchObject({
    setExpanded: expect.any(Function),
    clamp: expect.any(Function),
    orbWorkspacePath: expect.any(Function),
    setSessionRunning: expect.any(Function),
    onSelectionPrompt: expect.any(Function),
  })
  expect(api.selection).toMatchObject({
    search: expect.any(Function),
    translate: expect.any(Function),
    explain: expect.any(Function),
    setLanguage: expect.any(Function),
    interact: expect.any(Function),
    setContentSize: expect.any(Function),
    onState: expect.any(Function),
  })
  expect(api.floating).not.toHaveProperty('toggle')
  expect(api.floating).not.toHaveProperty('dock')
  await api.floating.setExpanded(true)
  await api.floating.clamp()
  await api.floating.orbWorkspacePath()
  await api.floating.setSessionRunning(true)
  await api.selection.search()
  await api.selection.interact()
  await api.selection.setContentSize({ width: 280, height: 120 })
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.floatingSetExpanded, true],
    [DESKTOP_IPC.floatingClamp],
    [DESKTOP_IPC.floatingOrbWorkspace],
    [DESKTOP_IPC.floatingRunning, true],
    [DESKTOP_IPC.selectionSearch],
    [DESKTOP_IPC.selectionInteract],
    [DESKTOP_IPC.selectionSetContentSize, { width: 280, height: 120 }],
  ])
})
