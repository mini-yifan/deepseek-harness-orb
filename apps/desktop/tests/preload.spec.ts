import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.clearAllMocks(); vi.resetModules() })

it('exposes overlay expand, clamp, and dsh_orb workspace IPC', async () => {
  await import('../src/preload.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopApi
  expect(api.floating).toMatchObject({
    setExpanded: expect.any(Function),
    clamp: expect.any(Function),
    orbWorkspacePath: expect.any(Function),
  })
  expect(api.floating).not.toHaveProperty('toggle')
  expect(api.floating).not.toHaveProperty('dock')
  await api.floating.setExpanded(true)
  await api.floating.clamp()
  await api.floating.orbWorkspacePath()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.floatingSetExpanded, true],
    [DESKTOP_IPC.floatingClamp],
    [DESKTOP_IPC.floatingOrbWorkspace],
  ])
})
