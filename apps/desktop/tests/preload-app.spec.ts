import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopAppApi, type DshDesktopStartupApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

it.each(['https://shell/startup.html'])('exposes only the carrier marker to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
})

it('exposes floating-ball Settings controls to application documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopAppApi
  await api.orb.supported()
  await api.orb.snapshot()
  await api.orb.pickAvatar()
  await api.orb.restoreAvatar()
  await api.orb.setOverlayModel({ provider: 'deepseek-official', model: 'deepseek-flash' })
  await api.orb.setBackgroundModel({ provider: 'deepseek-official', model: 'deepseek-chat' })
  await api.orb.setSelectionEnabled(false)
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.orbSupported],
    [DESKTOP_IPC.orbSnapshot],
    [DESKTOP_IPC.orbPickAvatar],
    [DESKTOP_IPC.orbRestoreAvatar],
    [DESKTOP_IPC.orbSetOverlayModel, { provider: 'deepseek-official', model: 'deepseek-flash' }],
    [DESKTOP_IPC.orbSetBackgroundModel, { provider: 'deepseek-official', model: 'deepseek-chat' }],
    [DESKTOP_IPC.orbSetSelectionEnabled, false],
  ])
  expect(api).not.toHaveProperty('plugins')
  expect(api).not.toHaveProperty('floating')
})

it('provides startup controls and a removable state subscription to shell documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://shell/startup.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopStartupApi
  await api.locale()
  await api.backend.status()
  await api.disablePlugins()
  await api.resetConfiguration()
  await api.restart()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.localeGet], [DESKTOP_IPC.backendStatus],
    [DESKTOP_IPC.pluginsDisableAll], [DESKTOP_IPC.configurationReset], [DESKTOP_IPC.applicationRestart],
  ])
  const listener = vi.fn()
  const dispose = api.backend.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, state: unknown) => void
  handler({}, { phase: 'error', message: 'startup failed' })
  expect(listener).toHaveBeenCalledWith({ phase: 'error', message: 'startup failed' })
  dispose()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.backendState, handler)
  expect(api).not.toHaveProperty('plugins')
})
