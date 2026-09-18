import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { DESKTOP_IPC } from '../src/ipc.ts'
import {
  defaultFloatingBallOrigin,
  expandedOverlayBounds,
  FLOATING_CHROME_INSET,
} from '../src/floating-window.ts'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
    return { promise, resolve, reject }
  }
  const windows: FakeWindow[] = []
  const hosts: FakeHost[] = []
  const handlers = new Map<string, (event: { sender?: unknown; senderFrame: { url: string } }, ...args: unknown[]) => unknown>()
  let pluginsEnabled = false
  let preparing = deferred()
  let prepared = deferred()
  let hostStarted = deferred()
  let navigated = deferred()
  let errorPublished = deferred()
  let quitCompleted = deferred()
  let nextMediaSourceId = 4242
  class FakeWindow extends EventEmitter {
    destroyed = false
    contentProtection = false
    ignoreMouseEvents = false
    ignoreMouseEventsForward: boolean | undefined = undefined
    visibleOnAllWorkspaces = false
    visibleOnAllWorkspacesOptions: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean } | undefined = undefined
    bounds = { x: 0, y: 0, width: 72, height: 72 }
    visible = false
    focused = false
    readonly mediaSourceId: string
    readonly urls: string[] = []
    readonly webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
      getURL: () => this.urls.at(-1) ?? '',
      executeJavaScript: vi.fn(async () => undefined),
      send: vi.fn((channel: string, state: { phase?: string }) => {
        if (channel === 'dsh-desktop:backend-state' && state.phase === 'error') errorPublished.resolve()
      }),
    })
    readonly show = vi.fn(() => { this.visible = true; this.focused = true })
    readonly showInactive = vi.fn(() => { this.visible = true })
    readonly hide = vi.fn(() => { this.visible = false })
    readonly focus = vi.fn(() => { this.focused = true })
    readonly blur = vi.fn(() => { this.focused = false })
    readonly restore = vi.fn()
    constructor(readonly options: {
      show?: boolean
      type?: string
      width?: number
      height?: number
      focusable?: boolean
      x?: number
      y?: number
    }) {
      super()
      this.mediaSourceId = `window:${String(nextMediaSourceId++)}:0`
      windows.push(this)
      if (typeof options.x === 'number') this.bounds.x = options.x
      if (typeof options.y === 'number') this.bounds.y = options.y
      if (typeof options.width === 'number') this.bounds.width = options.width
      if (typeof options.height === 'number') this.bounds.height = options.height
      this.visible = options.show === true
    }
    getMediaSourceId() { return this.mediaSourceId }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    isVisible() { return this.visible }
    isFocused() { return this.focused }
    setContentProtection(value: boolean) { this.contentProtection = value }
    setIgnoreMouseEvents(value: boolean, options?: { forward?: boolean }) {
      this.ignoreMouseEvents = value
      this.ignoreMouseEventsForward = options?.forward
    }
    setVisibleOnAllWorkspaces(
      value: boolean,
      options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean },
    ) {
      this.visibleOnAllWorkspaces = value
      this.visibleOnAllWorkspacesOptions = options
    }
    setPosition(x: number, y: number) { this.bounds.x = x; this.bounds.y = y }
    getBounds() { return { ...this.bounds } }
    setSize(width: number, height: number) { this.bounds.width = width; this.bounds.height = height }
    setBounds(next: { x: number; y: number; width: number; height: number }) { this.bounds = { ...next } }
    static getAllWindows() { return windows.filter(window => !window.destroyed) }
    static fromWebContents(contents: unknown) {
      return windows.find(window => window.webContents === contents) ?? null
    }
    async loadURL(url: string) {
      this.urls.push(url)
      if (url === 'dsh-app://app/index.html') navigated.resolve()
    }
    close() { this.destroyed = true; this.emit('closed') }
  }
  class FakeHost {
    readonly ready = deferred()
    readonly exited = deferred()
    readonly stopping = deferred()
    readonly onOverlayGuard: ((event: {
      type: 'overlay-guard'
      requestId: number
      action: 'begin' | 'end'
      mode: 'capture' | 'input'
    }) => readonly number[] | Promise<readonly number[]>) | undefined
    readonly start = vi.fn(() => { hostStarted.resolve(); return this.ready.promise })
    readonly stop = vi.fn(() => {
      this.stopping.resolve()
      this.ready.reject(new Error('child stopped'))
      return this.exited.promise
    })
    readonly setOrbCodeAgentModel = vi.fn()
    readonly setOrbPermissionPreset = vi.fn()
    constructor(
      readonly node: string,
      readonly runtime: string,
      readonly profile: string,
      _inspectPort?: number,
      _environment?: NodeJS.ProcessEnv,
      readonly onFailure?: (error: Error) => void,
      onOverlayGuard?: FakeHost['onOverlayGuard'],
    ) {
      this.onOverlayGuard = onOverlayGuard
      hosts.push(this)
    }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    name: 'Desktop test',
    whenReady: () => Promise.resolve(),
    getLocale: () => 'en-US',
    getVersion: () => '1.0.0',
    getAppPath: () => 'desktop-test-app',
    requestSingleInstanceLock: () => true,
    exit: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(() => {
      const event = { preventDefault: vi.fn() }
      app.emit('before-quit', event)
      if (event.preventDefault.mock.calls.length === 0) quitCompleted.resolve()
    }),
    dock: { show: vi.fn() },
    setActivationPolicy: vi.fn(),
  })
  const selectionMonitor = {
    onEvent: undefined as ((event: { type: string; text?: string; x?: number; y?: number; pid?: number }) => void) | undefined,
    activatePid: vi.fn(),
    start(handlers: { onEvent: (event: { type: string; text?: string; x?: number; y?: number; pid?: number }) => void }) {
      selectionMonitor.onEvent = handlers.onEvent
      selectionMonitor.activatePid.mockReset()
      return {
        stop: vi.fn(),
        setExcludePids: vi.fn(),
        activatePid: selectionMonitor.activatePid,
      }
    },
  }
  return {
    windows, hosts, handlers, app, FakeWindow, FakeHost, selectionMonitor,
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
    applyRelease: vi.fn(() => { preparing.resolve(); return prepared.promise }),
    assertProfileRuntime: vi.fn(),
    canRecoverProfile: vi.fn(() => true),
    get preparing() { return preparing }, get prepared() { return prepared },
    get hostStarted() { return hostStarted }, get navigated() { return navigated },
    get errorPublished() { return errorPublished }, get quitCompleted() { return quitCompleted },
    nextHostStart() { hostStarted = deferred(); return hostStarted.promise },
    get pluginsEnabled() { return pluginsEnabled },
    set pluginsEnabled(value: boolean) { pluginsEnabled = value },
    reset() {
      windows.length = 0; hosts.length = 0; handlers.clear(); app.removeAllListeners()
      app.isPackaged = true
      pluginsEnabled = false
      nextMediaSourceId = 4242
      selectionMonitor.onEvent = undefined
      selectionMonitor.activatePid.mockReset()
      preparing = deferred(); prepared = deferred(); hostStarted = deferred()
      navigated = deferred(); errorPublished = deferred(); quitCompleted = deferred()
    },
  }
})

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: harness.FakeWindow,
  dialog: harness.dialog,
  ipcMain: {
    handle: (channel: string, handler: (
      event: { sender?: unknown; senderFrame: { url: string } },
      ...args: unknown[]
    ) => unknown) => { harness.handlers.set(channel, handler) },
  },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: { isTrustedAccessibilityClient: vi.fn(() => false) },
}))
vi.mock('../src/paths.ts', () => ({
  resolveDesktopPaths: () => ({ profile: 'desktop-test-profile', orbWorkspace: 'desktop-test-orb' }),
}))
vi.mock('../src/project-manager.ts', () => ({
  DesktopProjectManager: class {
    readonly applyRelease = harness.applyRelease
    readonly assertProfileRuntime = harness.assertProfileRuntime
    canRecoverProfile = harness.canRecoverProfile
    async mutate(_mutation: unknown, hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await hooks.beforeChange()
      harness.pluginsEnabled = false
      await hooks.afterChange()
    }
    async resetConfiguration(hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await this.mutate(undefined, hooks)
    }
  },
}))
vi.mock('../src/host-process.ts', () => ({ DesktopHostProcess: harness.FakeHost }))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: vi.fn() }))
vi.mock('../src/selection-monitor.ts', () => ({
  startSelectionMonitor: (
    handlers: { onEvent: (event: { type: string; text?: string; x?: number; y?: number }) => void },
  ) => harness.selectionMonitor.start(handlers),
}))

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = harness.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  return handler({ senderFrame: { url: 'dsh-app://shell/startup.html' } }, ...args)
}

function invokeFloating(channel: string, ...args: unknown[]): unknown {
  const handler = harness.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  const window = harness.windows.find(entry => entry.options.type === 'panel')
  if (window === undefined) throw new Error('missing floating window')
  return handler({ sender: window.webContents, senderFrame: { url: 'dsh-app://shell/floating.html' } }, ...args)
}

function invokeSelection(channel: string, ...args: unknown[]): unknown {
  const handler = harness.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  const window = harness.windows.find(entry => entry.options.focusable === false)
  if (window === undefined) throw new Error('missing selection toolbar')
  return handler({ sender: window.webContents, senderFrame: { url: 'dsh-app://shell/selection-toolbar.html' } }, ...args)
}

function appWindows(): typeof harness.windows {
  return harness.windows.filter(window => window.options.type !== 'panel')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  harness.reset()
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', 'test-node')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', 'test-pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'test-runtime')
  vi.stubGlobal('process', { ...process, resourcesPath: 'desktop-test-resources' })
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', undefined)
})

afterEach(async () => {
  harness.prepared.resolve()
  for (const host of harness.hosts) { host.ready.resolve(); host.exited.resolve() }
  harness.app.quit()
  await harness.quitCompleted.promise
  vi.restoreAllMocks()
  harness.canRecoverProfile.mockReturnValue(true)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('desktop main startup', () => {
  it('exits with a diagnostic when both initialization and emergency navigation fail', async () => {
    const exited = Promise.withResolvers<undefined>()
    vi.spyOn(harness.app, 'getLocale').mockImplementationOnce(() => { throw new Error('locale unavailable') })
    vi.spyOn(harness.FakeWindow.prototype, 'loadURL').mockRejectedValueOnce(new Error('emergency navigation failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.app.exit.mockImplementationOnce(() => { exited.resolve(undefined) })
    await import('../src/main.ts')
    await exited.promise
    expect(harness.app.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'emergency navigation failed' }))
  })

  it('withholds profile recovery after application resources fail to load', async () => {
    harness.canRecoverProfile.mockReturnValue(false)
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.reject(new Error('runtime resources missing'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: false })
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    const html = decodeURIComponent(window.urls.at(-1)!)
    expect(html).toContain('dsh-recovery://restart')
    expect(html).not.toContain('dsh-recovery://reset')
    expect(html).not.toContain('dsh-recovery://plugins')
  })

  it('reloads a crashed startup renderer in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await harness.errorPublished.promise
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://shell/startup.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', message: 'Desktop renderer exited: crashed' })
  })

  it.each(['plugins', 'reset'])('runs %s recovery from a document with a broken preload', async (action) => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    const started = harness.nextHostStart()
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', event, `dsh-recovery://${action}/?`)
    await harness.hosts[0]!.stopping.promise
    harness.hosts[0]!.exited.resolve()
    await started
    harness.hosts[1]!.ready.resolve()
    await harness.navigated.promise
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.urls.at(-1)).toBe('dsh-app://app/index.html')
  })

  it('allows a full profile reset for an unclassified startup failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Unknown startup failure'))
    await harness.errorPublished.promise
    const started = harness.nextHostStart()
    const reset = Promise.resolve(invoke(DESKTOP_IPC.configurationReset))
    await started
    harness.hosts[1]!.ready.resolve()
    await reset
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('keeps a self-contained reinstall document in the main window after preload failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(decodeURIComponent(window.urls.at(-1)!)).toContain('preload unavailable')
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    expect(appWindows()).toHaveLength(1)
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('offers plugin recovery and disables plugins before restarting in the same window', async () => {
    harness.pluginsEnabled = true
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Plugin initialization failed'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: true })
    const nextStarted = harness.nextHostStart()
    const recovery = Promise.resolve(invoke(DESKTOP_IPC.pluginsDisableAll))
    await nextStarted
    expect(harness.pluginsEnabled).toBe(false)
    harness.hosts[1]!.ready.resolve()
    await recovery
    expect(appWindows()).toHaveLength(1)
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('waits for Host exit before relaunching the application', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const restart = Promise.resolve(invoke(DESKTOP_IPC.applicationRestart))
    await harness.hosts[0]!.stopping.promise
    expect(harness.app.relaunch).not.toHaveBeenCalled()
    harness.hosts[0]!.exited.resolve()
    await restart
    expect(harness.app.relaunch).toHaveBeenCalledOnce()
  })

  it('shows the loading window before profile preparation and starts one actual Host', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(harness.windows).toHaveLength(1)
    const window = harness.windows[0]!
    expect(window.options.show).toBe(true)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.hosts).toHaveLength(0)
    const retry = invoke(DESKTOP_IPC.backendRetry)
    const secondRetry = invoke(DESKTOP_IPC.backendRetry)
    harness.prepared.resolve()
    await harness.hostStarted.promise
    expect(harness.hosts).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    harness.hosts[0]!.ready.resolve()
    await Promise.all([retry, secondRetry, harness.navigated.promise])
    expect(harness.applyRelease).toHaveBeenCalledTimes(1)
    expect(harness.assertProfileRuntime).toHaveBeenCalledWith('desktop-test-profile')
    expect(harness.hosts[0]).toMatchObject({
      node: join('desktop-test-resources', 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      runtime: join('desktop-test-resources', 'dsh'),
      profile: 'desktop-test-profile',
    })
    expect(harness.hosts[0]!.start).toHaveBeenCalledTimes(1)
    expect(appWindows()).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://app/index.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('starts the unpackaged Host from the application development directory', async () => {
    harness.app.isPackaged = false
    await import('../src/main.ts')
    await harness.hostStarted.promise
    const project = join(harness.app.getAppPath(), '.desktop-build', 'development', 'project')
    expect(harness.hosts[0]).toMatchObject({ node: 'test-node', runtime: project, profile: project })
    expect(harness.applyRelease).not.toHaveBeenCalled()
    expect(harness.assertProfileRuntime).not.toHaveBeenCalled()
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('keeps startup errors and a successful retry in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const first = harness.hosts[0]!
    const failedRetry = expect(Promise.resolve(invoke(DESKTOP_IPC.backendRetry))).rejects.toThrow('plugin composition failed')
    first.exited.resolve()
    first.ready.reject(new Error('plugin composition failed'))
    await harness.errorPublished.promise
    await failedRetry
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'error', message: 'plugin composition failed', profileRecovery: true })
    expect(harness.windows[0]!.urls).toEqual(['dsh-app://shell/startup.html'])
    const nextStarted = harness.nextHostStart()
    const retry = Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    await nextStarted
    expect(harness.hosts).toHaveLength(2)
    harness.hosts[1]!.ready.resolve()
    await retry
    expect(appWindows()).toHaveLength(1)
    expect(harness.windows[0]!.urls.at(-1)).toBe('dsh-app://app/index.html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('waits for a pending child to exit on quit without late window navigation', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const window = harness.windows[0]!
    const host = harness.hosts[0]!
    host.stop.mockImplementation(() => { host.stopping.resolve(); return host.exited.promise })
    window.close()
    harness.app.quit()
    await host.stopping.promise
    expect(harness.app.quit).toHaveBeenCalledTimes(1)
    host.ready.resolve()
    host.exited.resolve()
    await harness.quitCompleted.promise
    expect(host.stop).toHaveBeenCalledTimes(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.windows).toHaveLength(1)
  })
})

describe('desktop floating overlay', () => {
  it('enables CORS so the overlay can fetch the Host API', async () => {
    const { protocol } = await import('electron')
    await import('../src/main.ts')
    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: 'dsh-app',
        privileges: expect.objectContaining({ corsEnabled: true, supportFetchAPI: true }),
      }),
    ])
  })

  it('creates a macOS overlay after Host ready without standing contentProtection', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: 'desktop-test-resources' })
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const overlay = harness.windows.find(window => window.options.type === 'panel')
    expect(overlay).toBeDefined()
    expect(overlay?.urls).toEqual(['dsh-app://shell/floating.html'])
    const primaryWorkArea = { x: 0, y: 0, width: 1440, height: 900 }
    const origin = defaultFloatingBallOrigin(primaryWorkArea)
    expect(overlay?.bounds).toMatchObject({
      x: origin.x - FLOATING_CHROME_INSET,
      y: origin.y - FLOATING_CHROME_INSET,
    })
    expect(harness.hosts[0]!.setOrbCodeAgentModel).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'max',
    })
    expect(harness.hosts[0]!.setOrbPermissionPreset).toHaveBeenCalledWith('danger-full-access')
    expect(invokeFloating(DESKTOP_IPC.floatingOverlayModelGet)).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'max',
    })
    expect(invokeFloating(DESKTOP_IPC.floatingOverlayPermissionGet)).toBe('danger-full-access')
    const toolbar = harness.windows.find(window => window.options.focusable === false)
    expect(toolbar?.urls).toEqual(['dsh-app://shell/selection-toolbar.html'])
    expect(overlay?.contentProtection).toBe(false)
    expect(overlay?.visibleOnAllWorkspaces).toBe(true)
    expect(overlay?.visibleOnAllWorkspacesOptions).toEqual({
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    expect(harness.app.dock.show).toHaveBeenCalled()
    expect(harness.app.setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(appWindows()[0]?.contentProtection).toBe(false)
    expect(harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 1, action: 'begin', mode: 'capture',
    })).toEqual([4243])
    harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 6, action: 'end', mode: 'capture',
    })
    toolbar?.showInactive()
    expect(harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 5, action: 'begin', mode: 'capture',
    })).toEqual([4243, 4244])
    expect(overlay?.contentProtection).toBe(false)
    expect(overlay?.ignoreMouseEvents).toBe(false)
    harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 2, action: 'end', mode: 'capture',
    })
    expect(overlay?.contentProtection).toBe(false)
    const inputBegin = harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 3, action: 'begin', mode: 'input',
    })
    expect(overlay?.ignoreMouseEvents).toBe(true)
    expect(overlay?.ignoreMouseEventsForward).toBe(false)
    expect(toolbar?.hide).toHaveBeenCalled()
    expect(inputBegin).toBeInstanceOf(Promise)
    expect(overlay?.blur).toHaveBeenCalled()
    harness.hosts[0]!.onOverlayGuard?.({
      type: 'overlay-guard', requestId: 4, action: 'end', mode: 'input',
    })
    expect(overlay?.ignoreMouseEvents).toBe(false)
    expect(invokeFloating(DESKTOP_IPC.floatingSetExpanded, true)).toMatchObject({
      expanded: true,
      horizontal: 'left',
      vertical: 'up',
    })
    const expanded = expandedOverlayBounds(origin, primaryWorkArea)
    expect(overlay?.bounds).toMatchObject({
      x: expanded.x,
      y: expanded.y,
      width: expanded.width,
      height: expanded.height,
    })
    invokeFloating(DESKTOP_IPC.floatingSetExpanded, false)
    invokeFloating(DESKTOP_IPC.floatingMove, 20, 30)
    expect(overlay?.bounds).toMatchObject({
      x: 20 - FLOATING_CHROME_INSET,
      y: 30 - FLOATING_CHROME_INSET,
    })
    invokeFloating(DESKTOP_IPC.floatingClamp)
    expect(overlay?.bounds).toMatchObject({
      x: 20 - FLOATING_CHROME_INSET,
      y: 30 - FLOATING_CHROME_INSET,
    })
    for (const window of harness.windows) {
      expect(window.webContents.executeJavaScript).not.toHaveBeenCalled()
    }
  })

  it('restores overlay chrome when the Host stops', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: 'desktop-test-resources' })
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const overlay = harness.windows.find(window => window.options.type === 'panel')
    const host = harness.hosts[0]!
    host.onOverlayGuard?.({ type: 'overlay-guard', requestId: 1, action: 'begin', mode: 'input' })
    expect(overlay?.ignoreMouseEvents).toBe(true)
    host.stop.mockImplementation(() => {
      host.stopping.resolve()
      return host.exited.promise
    })
    harness.app.quit()
    await host.stopping.promise
    host.exited.resolve()
    await harness.quitCompleted.promise
    expect(overlay?.contentProtection).toBe(false)
    expect(overlay?.ignoreMouseEvents).toBe(false)
  })

  it('does not create a floating overlay off macOS', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux', resourcesPath: 'desktop-test-resources' })
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    expect(harness.windows.some(window => window.options.type === 'panel')).toBe(false)
    expect(appWindows()).toHaveLength(1)
    expect(appWindows()[0]?.contentProtection).toBe(false)
    expect(harness.app.dock.show).not.toHaveBeenCalled()
    expect(harness.app.setActivationPolicy).not.toHaveBeenCalled()
  })

  it('does not show the main window when the selection toolbar translates or attaches', async () => {
    vi.setSystemTime(1_000)
    vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: 'desktop-test-resources' })
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const main = appWindows()[0]!
    const overlay = harness.windows.find(window => window.options.type === 'panel')
    const toolbar = harness.windows.find(window => window.options.focusable === false)
    main.focus()
    main.show.mockClear()
    main.focus.mockClear()
    if (harness.selectionMonitor.onEvent === undefined) throw new Error('missing selection monitor')
    harness.selectionMonitor.onEvent({ type: 'selection', text: 'hello', pid: 7, x: 40, y: 50 })
    invokeSelection(DESKTOP_IPC.selectionTranslate)
    expect(harness.selectionMonitor.activatePid).toHaveBeenCalledWith(7)
    expect(overlay?.webContents.send).toHaveBeenCalledWith(
      DESKTOP_IPC.selectionPrompt,
      expect.objectContaining({ text: expect.stringContaining('Translate the following into Chinese') }),
    )
    expect(overlay?.showInactive).toHaveBeenCalled()
    expect(toolbar?.hide).toHaveBeenCalled()
    expect(main.blur).toHaveBeenCalled()
    expect(main.show).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
    harness.selectionMonitor.activatePid.mockClear()
    overlay?.focus.mockClear()
    invokeSelection(DESKTOP_IPC.selectionAttach)
    expect(overlay?.webContents.send).toHaveBeenCalledWith(
      DESKTOP_IPC.selectionAttach,
      { text: 'hello' },
    )
    expect(overlay?.focus).toHaveBeenCalled()
    expect(harness.selectionMonitor.activatePid).not.toHaveBeenCalled()
    expect(main.show).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
    invokeSelection(DESKTOP_IPC.selectionInteract)
    invokeSelection(DESKTOP_IPC.selectionSetContentSize, { width: 280, height: 120 })
    expect(toolbar?.bounds).toMatchObject({ width: 280, height: 120 })
    overlay?.showInactive.mockClear()
    invokeFloating(DESKTOP_IPC.floatingSetExpanded, true)
    expect(overlay?.showInactive).not.toHaveBeenCalled()
    expect(harness.selectionMonitor.activatePid).not.toHaveBeenCalled()
    harness.app.emit('activate')
    expect(main.show).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
    vi.setSystemTime(3_500)
    harness.app.emit('activate')
    expect(main.show).toHaveBeenCalled()
    expect(main.focus).toHaveBeenCalled()
  })

  it('installs the standard Edit and Window menus so clipboard shortcuts reach inputs', async () => {
    const { Menu } = await import('electron')
    await import('../src/main.ts')
    expect(Menu.buildFromTemplate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: 'editMenu' }),
      expect.objectContaining({ role: 'windowMenu' }),
    ]))
  })
})
