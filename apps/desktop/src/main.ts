import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager } from './project-manager.ts'
import { DesktopHostFatalError, DesktopHostProcess, DesktopHostUncleanExitError, type DesktopHostOrbCommand, type DesktopOrbHostHandlers } from './host-process.ts'
import { captureExcludedRegionOnElectron } from './macos-sck-napi.ts'
import { DesktopPlatformView, PLATFORM_IPC, platformBounds } from './platform-view.ts'
import { installDesktopDirectoryPicker } from './directory-picker.ts'
import { installMicrophonePermissions } from './microphone-permissions.ts'
import { DesktopBackendController } from './backend-controller.ts'
import { DESKTOP_IPC, SCHEME, assertDesktopSender, type DesktopUpdateState, type OrbMillifractionWriteResult, type OrbSettingsSnapshot } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale, resolveDesktopStartupLocale } from './locale.ts'
import {
  applyFloatingOverlayGuard,
  clampFloatingWindow,
  createFloatingWindow,
  moveFloatingBall,
  OVERLAY_GUARD_INPUT_APPLY_MS,
  overlayWindowExcludeIds,
  resetFloatingOverlayGuard,
  setFloatingExpanded,
  unsnapDockedBall,
} from './floating-window.ts'
import { ensureOrbWorkspaceDir, readFloatingSessionId, writeFloatingSessionId } from './floating-session.ts'
import { isOrbAgentModelSelection, readOrbAgentModels, writeOrbAgentModels, type OrbAgentModelSelection } from './orb-agent-models.ts'
import { isOrbPermissionPreset, readOrbPermission, writeOrbPermission } from './orb-permission.ts'
import {
  assertOrbSettingsWritable,
  DEFAULT_ORB_AVATAR_FILE,
  installOrbAvatarFromPath,
  ORB_AVATAR_PATH,
  orbAvatarCacheToken,
  orbAvatarUrl,
  orbSettingsSupported,
  restoreOrbAvatar,
  serveOrbAvatar,
} from './orb-avatar.ts'
import { applyMillifractionCoordinates } from './millifraction-coordinates-apply.ts'
import { orbCoordinateModeFor, readMillifractionCoordinates, writeMillifractionCoordinates } from './millifraction-coordinates.ts'
import { isTccRight, TccController } from './tcc.ts'
import { SelectionToolbarController } from './selection-toolbar-controller.ts'
import { createSelectionToolbarWindow, hideSelectionToolbar, pointInWindow } from './selection-toolbar-window.ts'
import {
  createObservationFrameWindow,
  hideObservationFrame,
  raiseOverlayAboveObservationFrame,
  showObservationFrame,
} from './observation-frame-window.ts'
import type { FloatingModelCatalog } from './floating-agent-menu.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { serveWebDocument, serveOverlayDocument, authenticateWebHost, forwardWebRequest } from './web-document.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { pruneCrashReports, RendererConsoleTail, writeCrashReport, type CrashReportSource } from './crash-report.ts'
import { openWelcomeWindow } from './welcome-window.ts'
import { WELCOME_IPC, needsWelcome } from './welcome-api.ts'
import { connectDesktopWelcome, type DesktopWelcomeBackend } from './welcome-backend.ts'
import { DesktopUpdateJournal } from './update-journal.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'
import { DesktopUpdateSchedule, resolveDesktopUpdateScheduleConfig } from './update-schedule.ts'
import { desktopUpdateErrorSummary, presentDesktopUpdate } from './update-presentation.ts'
import { desktopErrorState } from './startup-error.ts'
import { DesktopMandatoryUpdatePolicy, resolveDesktopPolicyConfig, type DesktopPolicyState } from './mandatory-update-policy.ts'
import { DesktopMandatoryUpdateWindow } from './mandatory-update-window.ts'
import { DesktopPolicyTestAuth } from './policy-test-auth.ts'
import { DesktopUpdateDialog, type UpdateDialogOptions } from './update-dialog.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { DesktopBrowserGuests } from './browser-guests.ts'

let focusPrimaryWindow = (): void => {}
let stopForRecovery = async (): Promise<void> => {}
let shuttingDown = false
let windowsLanguage: string | undefined
/**
 * Whether the backend has reached ready: false until the first ready, back to
 * false when a restart returns it to starting, frozen during shutdown so a
 * failure while tearing down a ready backend still reads as `running`.
 */
let backendReady = false
/** Error-level console output of the primary window, attached to crash reports. */
const rendererConsole = new RendererConsoleTail()

// Platform-conventional logs directory (macOS ~/Library/Logs/<name>, otherwise under userData);
// set before ready so the first fatal report already resolves under it.
app.setAppLogsPath()

function currentDesktopLocale(): ReturnType<typeof resolveDesktopLocale> {
  return resolveDesktopLocale(windowsLanguage ?? app.getLocale())
}
const recovery = new DesktopFatalRecovery({
  messages: () => currentDesktopLocale().messages,
  show: options => dialog.showMessageBox(options),
  stop: () => { shuttingDown = true; return stopForRecovery() },
  disablePlugins: async () => {
    const manager = new DesktopProjectManager(resolveDesktopPaths(), runtimeResources())
    const backupPath = await manager.disableAllPlugins()
    console.info('Desktop profile recovery completed:', { profilePatchBackup: backupPath ?? null, homePatch: 'unchanged' })
  },
  exit: () => { app.quit() },
  restart: () => { app.relaunch(); app.quit() },
  writeReport: (error, source) => persistCrashReport(error, source),
})

function persistCrashReport(error: unknown, source: CrashReportSource): Promise<string | undefined> {
  return writeCrashReport(app.getPath('logs'), {
    source,
    phase: backendReady ? 'running' : 'startup',
    error,
    ...(error instanceof DesktopHostFatalError && error.diagnostic !== undefined ? { hostDiagnostic: error.diagnostic } : {}),
    rendererConsole: rendererConsole.snapshot(),
    app: {
      name: app.name, version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: currentDesktopLocale().id,
    },
    time: new Date(),
  })
}

function reportFatal(error: unknown, source: CrashReportSource): void {
  console.error(error)
  if (shuttingDown) {
    // No dialog during shutdown, but the report still records what failed on the way out.
    void persistCrashReport(error, source)
    return
  }
  void recovery.report(error, source).catch((failure: unknown) => { console.error(failure); app.exit(1) })
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
}])

interface RuntimeResources {
  readonly nodeBin: string
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = process.execPath
  const nodeBin = development ? join(app.getAppPath(), 'scripts', 'node-bin') : join(process.resourcesPath, 'runtime', 'bin')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? (development ? join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      : join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'))
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined)
    ?? (development ? join(app.getAppPath(), '.desktop-build', 'development', 'project') : join(app.getAppPath(), 'dsh'))
  return { node, nodeBin, pnpm, dsh }
}

function developmentPrimaryRuntime(): string {
  const directory = process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  if (directory === undefined || directory === '') {
    throw new Error('dsh desktop: DSH_DESKTOP_PRIMARY_RUNTIME_DIR is required for an unpackaged launch')
  }
  return directory
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

/**
 * Opaque chrome fallback matching the built-in sidebar palette (the resolved
 * `--dsw-static-neutral-bluish-900` / `-50` tokens). An approximation for
 * custom themes: Windows swaps in the renderer's measured palette over the
 * windowsAppearance IPC, and macOS shows it only while minimized or hidden.
 * @returns the sidebar fill hex for the active system color scheme.
 */
function chromeFallbackFill(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'
}

/**
 * Add the effective Desktop palette to a Platform authorization URL so the
 * login page opens in the application's theme. `system` resolves through
 * `nativeTheme.shouldUseDarkColors`, which follows the theme source the
 * application preload publishes.
 * @param authorizeUrl - validated Platform authorization URL.
 * @returns the authorization URL carrying `theme=light` or `theme=dark`.
 */
function overlayGuardInputApplyDelay(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, OVERLAY_GUARD_INPUT_APPLY_MS)
    timer.unref()
  })
}

function platformLoginUrl(authorizeUrl: string): string {
  const url = new URL(authorizeUrl)
  url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  return url.href
}

function createWindow(preload: string, show = false, primary = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: primary,
      devTools: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.platform === 'darwin') {
    // macOS hides the traffic lights in fullscreen; the page drops its
    // clearance for them off the html[data-fullscreen] flag this feeds.
    const sendFullscreen = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    // Reloads and navigations re-register the preload listener; resend the
    // current state so a fullscreen reload does not fall back to windowed CSS.
    window.webContents.on('did-finish-load', sendFullscreen)
    // Deminiaturize reattaches the NSVisualEffectView material late
    // (electron/electron#25368), so a transparent window shows the desktop
    // through the sidebar until then. Paint an opaque base while minimized or
    // hidden so the deminiaturize animation and the reattachment gap show a
    // solid fill; restoring flips back, and the null -> 'sidebar' transition
    // forces the material to reattach.
    const applyBackdrop = (): void => {
      if (window.isDestroyed()) return
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null)
        window.setBackgroundColor(chromeFallbackFill())
      } else {
        window.setVibrancy('sidebar')
        window.setBackgroundColor('#00000000')
      }
    }
    window.on('minimize', applyBackdrop)
    window.on('hide', applyBackdrop)
    window.on('restore', applyBackdrop)
    window.on('show', applyBackdrop)
  }
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = currentDesktopLocale().messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (['http:', 'https:'].includes(destination.protocol)) void shell.openExternal(url)
    }
  })
  return window
}

async function main(): Promise<void> {
  void pruneCrashReports(app.getPath('logs'))
  const journalDirectory = process.env.DSH_DESKTOP_UPDATE_JOURNAL_DIR
  const updateJournal = journalDirectory === undefined ? undefined : new DesktopUpdateJournal(journalDirectory, app.getVersion())
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = !app.isPackaged
  const computerUsePatch = development
    ? join(app.getAppPath(), '..', '..', 'packages/experimental/tool-computer-use/cordis.patch.yml')
    : join(process.resourcesPath, 'computer-use', 'cordis.patch.yml')
  if (existsSync(computerUsePatch)) process.env.DSH_COMPUTER_USE_PATCH = computerUsePatch
  const primaryRuntime = development
    ? developmentPrimaryRuntime()
    : join(process.resourcesPath, 'runtime', 'primary-runtime')
  const activeProject = paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  let quitting = false
  let startup: Promise<void> | undefined
  let workspaceRecovery: Promise<void> | undefined
  let mainWindow: BrowserWindow | undefined
  // The backend listener is registered before this window exists and reads the binding later.
  // eslint-disable-next-line prefer-const -- assigned once when the floating window is created
  let floatingShell: BrowserWindow | undefined
  let observationFrameWindow: BrowserWindow | undefined
  let restoreOverlayGuard = (): void => {}
  const orbHostHandlers: DesktopOrbHostHandlers = {}
  let overlayTextEditing = false
  let millifractionApplying: Promise<OrbMillifractionWriteResult> | undefined
  let welcomeWindow: BrowserWindow | undefined
  let enteredWorkspace = false
  let shellInstallerOwnsQuit = false
  let requireCleanStop = false
  let updateStoppedHost = false
  let updateStopFailure: DesktopHostUncleanExitError | undefined
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const systemLanguages = app.getPreferredSystemLanguages()
  let locale = resolveDesktopStartupLocale(null, systemLanguages)
  windowsLanguage = locale.id
  let mandatoryPolicy: DesktopMandatoryUpdatePolicy | undefined
  let mandatoryUI: DesktopMandatoryUpdateWindow | undefined
  let policyAuth: DesktopPolicyTestAuth | undefined
  const isQuitting = (): boolean => quitting
  const currentMainWindow = (): BrowserWindow | undefined => mainWindow
  const ordinaryDialogs = new Set<AbortController>()
  const currentDialogWindow = (): BrowserWindow | undefined => welcomeWindow ?? mainWindow
  const updateDialog = new DesktopUpdateDialog(fileURLToPath(new URL('./preload-update-dialog.cjs', import.meta.url)), () => locale)
  const isMandatory = (): boolean => mandatoryPolicy?.state.blocking === true
  const ordinaryMessageBox = async (options: UpdateDialogOptions): Promise<Electron.MessageBoxReturnValue> => {
    const controller = new AbortController()
    ordinaryDialogs.add(controller)
    try {
      const parent = currentDialogWindow()
      if (parent === undefined) return { response: options.cancelId ?? 0, checkboxChecked: false }
      return await updateDialog.show(parent, { ...options, signal: controller.signal })
    }
    finally { ordinaryDialogs.delete(controller) }
  }
  // Copy comes from the same locale as the update prompts so the dialog
  // chrome and its content never mix languages.
  const showAbout = async (): Promise<void> => {
    await ordinaryMessageBox({ type: 'info', title: locale.messages.aboutMenu, message: locale.messages.aboutProduct,
      detail: formatDesktopMessage(locale.messages.aboutVersion, { version: app.getVersion() }),
      buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
  }
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const applicationUrl = `${SCHEME}://app/`
  let hostUrl: string | undefined
  let hostCookie: string | undefined
  const browserGuests = new DesktopBrowserGuests(() => hostUrl)
  let injections: readonly unknown[] = []
  let welcomeBackend: DesktopWelcomeBackend | undefined
  let stopAccount: (() => void) | undefined
  let openedAttempt: string | undefined
  let returnedAttempt: string | undefined
  let previousAccountStatus: string | undefined
  const assertProductSender = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['app'])
    if (mainWindow === undefined || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame === null || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('dsh desktop: rejected IPC from an unowned renderer')
    }
  }
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).catch((error: unknown) => {
      if (quitting || shuttingDown || window.isDestroyed() || navigation !== next
        || (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED')) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const platformView = new DesktopPlatformView(join(app.getAppPath(), 'lib', 'preload-platform-account.cjs'),
    () => locale.id === 'zh-CN' ? 'zh_CN' : 'en_US')
  const backend = new DesktopBackendController((onFailure) => {
    const hostInspectPort = developmentHostInspectPort(development)
    const host = new DesktopHostProcess(resources.node, resources.dsh, activeProject,
      hostInspectPort, process.env, (error) => {
        restoreOverlayGuard()
        onFailure(error)
      },
      primaryRuntime,
      resources, (next) => { platformView.setSession(next) }, orbHostHandlers)
    return {
      start: async () => {
        const ready = await host.start()
        hostCookie = await authenticateWebHost(ready.url)
        hostUrl = ready.url
        if (ready.injections === undefined) throw new Error('Desktop Host did not provide boot injections')
        injections = ready.injections
        welcomeBackend = await connectDesktopWelcome(ready.url, (input, init) => net.fetch(input, init), async () => (await session.defaultSession.cookies.get({ url: ready.url })).map(cookie => `${cookie.name}=${cookie.value}`).join('; '))
        stopAccount?.()
        stopAccount = welcomeBackend.account.watch((state) => {
          if (quitting) return
          if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send(WELCOME_IPC.state, state)
          const attempt = state.attempt
          if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
            openedAttempt = attempt.id
            void shell.openExternal(platformLoginUrl(attempt.authorizeUrl)).catch(() => undefined)
          }
          if ((attempt?.phase === 'failed' || attempt?.phase === 'expired') && returnedAttempt !== attempt.id) {
            returnedAttempt = attempt.id
            focusPrimaryWindow()
          }
          if (attempt?.phase === 'succeeded' && welcomeWindow !== undefined) void enterWorkspace().catch(() => undefined)
          if (previousAccountStatus === 'credential-stored' && state.status === 'signed-out') {
            void readWelcomeState().then((value) => {
              if (!value.hasApiKey && !quitting) { enteredWorkspace = false; return showWelcome() }
              return undefined
            }).catch(() => undefined)
          }
          previousAccountStatus = state.status
        }, () => {
          // The stream reconnects; a transport failure does not change account state.
        })
        pushStoredOrbPreferences(host)
      },
      stop: async () => {
        try { await host.stop(requireCleanStop) }
        catch (error) {
          if (!requireCleanStop || !(error instanceof DesktopHostUncleanExitError)) throw error
          // Backend cleanup succeeded; installation still rejects the unsuccessful task teardown.
          updateStopFailure = error
        } finally {
          restoreOverlayGuard()
        }
      },
      updateTasks: (action: 'inspect' | 'lock' | 'unlock') => host.updateTasks(action),
      sendOrb: (command: DesktopHostOrbCommand) => { host.sendOrb(command) },
      sendOrbCodeAgentModel: (selection: OrbAgentModelSelection) => { host.sendOrbCodeAgentModel(selection) },
    }
  }, (state) => {
    if (state.phase === 'error') reportFatal(state.failure, 'host')
    else if (!shuttingDown) backendReady = state.phase === 'ready'
    if (floatingShell !== undefined && !floatingShell.isDestroyed()) {
      floatingShell.webContents.send(DESKTOP_IPC.backendState, state.phase === 'error'
        ? { phase: 'error', message: state.message }
        : { phase: state.phase })
    }
  })

  const updateErrors = new WeakMap<DesktopUpdateState, Promise<void>>()
  const showUpdateFailure = (state: DesktopUpdateState): Promise<void> => {
    if (state.phase !== 'error') return Promise.resolve()
    if (isMandatory()) { mandatoryUI?.sync(); return Promise.resolve() }
    let shown = updateErrors.get(state)
    if (shown === undefined) {
      shown = ordinaryMessageBox({ type: 'error', title: locale.messages.updateFailedTitle,
        message: desktopUpdateErrorSummary(state, locale.messages),
        technicalDetails: state.technicalDetails ?? state.message ?? '' }).then(() => {})
      updateErrors.set(state, shown)
    }
    return shown
  }
  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateJournal?.state(state)
    updateState = state
    mandatoryUI?.sync()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesPresentation, presentDesktopUpdate(state))
    }
    if (state.phase === 'error' && state.failedOperation !== 'check') {
      const restoreHost = state.failedOperation === 'install' && updateStoppedHost && !quitting
      shellInstallerOwnsQuit = false
      updateStoppedHost = false
      if (restoreHost) {
        // Only confirmed process exit permits replacement before another installation confirmation.
        const hostReady = backend.start(async () => {})
        startup = hostReady
        const recovery = hostReady.then(async () => {
          if (quitting) return
          // A replacement Host can have a new port, cookie, or boot injections even at the same URL.
          navigation = undefined
          await navigateMain(applicationUrl)
          if (backend.host !== undefined) updateJournal?.action('workspace-ready')
        })
        workspaceRecovery = recovery
        void recovery.catch((error: unknown) => { reportFatal(error, 'main') }).finally(() => {
          if (startup === hostReady) startup = undefined
          if (workspaceRecovery === recovery) workspaceRecovery = undefined
        })
      }
      void showUpdateFailure(state).catch((error: unknown) => { console.error(error) })
    }
    return state
  }

  const readWelcomeState = async () => {
    if (backend.host === undefined || welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return welcomeBackend.read()
  }
  stopForRecovery = () => backend.close()

  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      await navigateMain(applicationUrl)
      await backend.start(async () => {
        await manager.applyRelease()
      })
      if (backend.host !== undefined) await openInitialWindow()
      if (backend.host !== undefined) updateJournal?.action('workspace-ready')
      // The existing Web document resumes through the boot IPC response.
    })().catch((error: unknown) => {
      updateJournal?.action('workspace-failed')
      reportFatal(error, 'main')
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      await workspaceRecovery
      await startup?.catch(() => undefined)
      const host = backend.host
      if (host === undefined) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      const active = await host.updateTasks('inspect')
      const confirmation: Electron.MessageBoxOptions = {
        type: active ? 'warning' : 'info', title: locale.messages.updateTitle,
        message: active ? locale.messages.updateActiveTasks : formatDesktopMessage(locale.messages.updateDownloadedTitle, { version: updates.state.version ?? '' }),
        detail: active ? locale.messages.updateActiveTasksDetail
          : locale.messages.updateDownloadedDetail,
        buttons: active ? [locale.messages.updateStopTasks, locale.messages.updateLater] : [locale.messages.installAndRestart],
        defaultId: 1, cancelId: 1,
      }
      if (isMandatory()) {
        if (!await mandatoryUI?.confirm(updates.state.version ?? '', active)) return false
      } else {
        const parent = currentDialogWindow()
        if (parent === undefined) return false
        const result = await updateDialog.show(parent, confirmation)
        if (result.response !== 0 || isMandatory()) return false
      }
      if (backend.host !== host) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      try {
        const stillActive = await host.updateTasks('lock')
        if (stillActive && !active) throw new DesktopUpdatePreparationError('tasks-changed', locale.messages.updateTasksChanged)
        mandatoryUI?.preparingRestart(stillActive)
        requireCleanStop = true
        updateStopFailure = undefined
        await backend.stop()
        updateStoppedHost = true
        // The backend's async cleanup callback can assign this after the reset above.
        const stopFailure = updateStopFailure as DesktopHostUncleanExitError | undefined
        if (stopFailure !== undefined) throw new DesktopUpdatePreparationError('stop-failed', locale.messages.updateStopFailed, stopFailure.message)
        updateJournal?.action('install-confirmed')
        shellInstallerOwnsQuit = true
      } catch (error) {
        if (!updateStoppedHost) await host.updateTasks('unlock').catch((unlockError: unknown) => { console.error(unlockError) })
        throw error
      } finally {
        requireCleanStop = false
      }
      return true
    },
  )

  const updateSchedule = new DesktopUpdateSchedule(updates, resolveDesktopUpdateScheduleConfig(process.env))

  const downloadUpdate = async (version: string): Promise<DesktopUpdateState> => {
    updateJournal?.action('download-requested')
    const state = await updates.download(version)
    if (state.phase !== 'ready' || quitting) return state
    // Only a completed user-driven download opens this prompt; cancelling installation does not reopen it.
    return updates.install(version)
  }

  const tcc = new TccController({
    platform: process.platform,
    appName: () => app.name,
    screenGranted: () => systemPreferences.getMediaAccessStatus('screen') === 'granted',
    accessibilityGranted: () => systemPreferences.isTrustedAccessibilityClient(false),
    openExternal: url => shell.openExternal(url),
  })

  function pushStoredOrbPreferences(host: DesktopHostProcess): void {
    host.sendOrbCodeAgentModel(readOrbAgentModels(paths.profile).background)
    host.sendOrb({ type: 'orb-permission', preset: readOrbPermission(paths.profile) })
    host.sendOrb({
      type: 'orb-coordinate-mode',
      mode: orbCoordinateModeFor(readMillifractionCoordinates(paths.profile).enabled),
    })
  }

  function publishTcc(): ReturnType<TccController['status']> {
    const status = tcc.status()
    if (floatingShell !== undefined && !floatingShell.isDestroyed()) {
      floatingShell.webContents.send(DESKTOP_IPC.floatingTcc, status)
    }
    return status
  }

  function requestOverlayNewSession(): void {
    const window = floatingShell
    if (window === undefined || window.isDestroyed()) return
    const send = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.floatingCreateSession)
    }
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send)
      return
    }
    send()
  }

  function persistOverlayModel(next: OrbAgentModelSelection): void {
    const current = readOrbAgentModels(paths.profile)
    writeOrbAgentModels(paths.profile, { overlay: next, background: current.background })
    if (floatingShell !== undefined && !floatingShell.isDestroyed()) {
      floatingShell.webContents.send(DESKTOP_IPC.floatingOverlayModel, next)
    }
  }

  function persistBackgroundModel(next: OrbAgentModelSelection): void {
    const current = readOrbAgentModels(paths.profile)
    writeOrbAgentModels(paths.profile, { overlay: current.overlay, background: next })
    backend.host?.sendOrbCodeAgentModel(next)
  }

  function publishAvatar(): void {
    if (floatingShell === undefined || floatingShell.isDestroyed()) return
    floatingShell.webContents.send(
      DESKTOP_IPC.floatingAvatar,
      orbAvatarUrl('shell', orbAvatarCacheToken(paths.profile)),
    )
  }

  function orbSnapshotFor(hostname: string): OrbSettingsSnapshot {
    const models = readOrbAgentModels(paths.profile)
    return {
      supported: orbSettingsSupported(process.platform),
      avatarUrl: orbAvatarUrl(hostname, orbAvatarCacheToken(paths.profile)),
      overlay: models.overlay,
      background: models.background,
      selectionEnabled: selectionController?.enabled() ?? true,
      millifractionEnabled: readMillifractionCoordinates(paths.profile).enabled,
      tcc: tcc.status(),
    }
  }

  async function confirmMillifractionEnabled(
    enabled: boolean,
    parent?: BrowserWindow,
  ): Promise<OrbMillifractionWriteResult> {
    if (millifractionApplying !== undefined) return millifractionApplying
    const run = (async (): Promise<OrbMillifractionWriteResult> => {
      const result = await applyMillifractionCoordinates({
        requestedEnabled: enabled,
        currentEnabled: readMillifractionCoordinates(paths.profile).enabled,
        messages: currentDesktopLocale().messages,
        dialog: {
          async show(options) {
            const box = {
              type: 'question' as const,
              title: options.title,
              message: options.message,
              detail: options.detail,
              buttons: [options.confirm, options.cancel],
              defaultId: 0,
              cancelId: 1,
            }
            const response = parent === undefined
              ? await dialog.showMessageBox(box)
              : await dialog.showMessageBox(parent, box)
            return response.response === 0
          },
        },
        persist: (next) => { writeMillifractionCoordinates(paths.profile, { enabled: next }) },
        pushHost: (mode) => { backend.host?.sendOrb({ type: 'orb-coordinate-mode', mode }) },
        createOverlaySession: requestOverlayNewSession,
      })
      if (!result.applied) return { cancelled: true }
      return { cancelled: false, snapshot: orbSnapshotFor('app') }
    })()
    millifractionApplying = run
    try {
      return await run
    } finally {
      millifractionApplying = undefined
    }
  }

  async function loadFloatingModelCatalog(): Promise<FloatingModelCatalog | undefined> {
    if (hostUrl === undefined || hostCookie === undefined) return undefined
    const rpcId = randomUUID()
    const response = await net.fetch(new URL('/api/session/modelCatalog', hostUrl).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: hostCookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method: 'session/modelCatalog',
        payload: { args: {} },
      }),
    })
    if (!response.ok) return undefined
    const envelope: unknown = await response.json()
    if (typeof envelope !== 'object' || envelope === null) return undefined
    const record = envelope as { type?: unknown; rpcId?: unknown; result?: { ok?: unknown; value?: unknown } }
    if (record.type !== 'server-response' || record.rpcId !== rpcId || record.result?.ok !== true) return undefined
    const value = record.result.value
    if (typeof value !== 'object' || value === null || !('groups' in value) || !Array.isArray(value.groups)) return undefined
    return value as FloatingModelCatalog
  }

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.pathname === ORB_AVATAR_PATH && (url.hostname === 'shell' || url.hostname === 'app')) {
      return serveOrbAvatar(
        paths.profile,
        join(app.getAppPath(), 'renderer', DEFAULT_ORB_AVATAR_FILE),
        request.method,
      )
    }
    // Shell-owned documents live in the application bundle and never pass through the Host.
    if (url.hostname === 'shell') return serveWebDocument(request, join(app.getAppPath(), 'renderer'))
    if (url.hostname === 'app') {
      const webRoot = join(resources.dsh, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
      if ((url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.get('surface') === 'overlay') {
        if (injections.length === 0 || hostUrl === undefined) return Promise.resolve(new Response(null, { status: 503 }))
        return serveOverlayDocument(request, webRoot, injections, new URL(hostUrl).origin)
      }
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
        return serveWebDocument(request, webRoot)
      }
      if (backend.host === undefined || hostUrl === undefined || hostCookie === undefined) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return forwardWebRequest(request, hostUrl, hostCookie)
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })

  const shellPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const messages = currentDesktopLocale().messages
  const selectionController = new SelectionToolbarController(paths.profile, {
    electronPid: process.pid,
    openExternal: url => shell.openExternal(url),
    promptOverlay(text) {
      if (floatingShell === undefined || floatingShell.isDestroyed()) return
      floatingShell.showInactive()
      floatingShell.webContents.send(DESKTOP_IPC.selectionPrompt, { text })
      hideSelectionToolbar(selectionController?.window())
    },
    attachOverlay(text) {
      if (floatingShell === undefined || floatingShell.isDestroyed()) return
      floatingShell.show()
      floatingShell.focus()
      floatingShell.webContents.send(DESKTOP_IPC.selectionAttach, { text })
      hideSelectionToolbar(selectionController?.window())
    },
    requestAccessibility: () => systemPreferences.isTrustedAccessibilityClient(true),
    accessibilityTrusted: () => systemPreferences.isTrustedAccessibilityClient(false),
  })
  const floatingWindow = floatingShell = createFloatingWindow(shellPreload, messages, () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  }, () => { app.quit() }, {
    enabled: () => selectionController?.enabled() === true,
    toggle: () => { selectionController?.toggle() },
  }, {
    loadCatalog: loadFloatingModelCatalog,
    overlay: () => readOrbAgentModels(paths.profile).overlay,
    background: () => readOrbAgentModels(paths.profile).background,
    onSelectOverlay: persistOverlayModel,
    onSelectBackground: persistBackgroundModel,
  }, {
    enabled: () => readMillifractionCoordinates(paths.profile).enabled,
    toggle: () => {
      const current = readMillifractionCoordinates(paths.profile).enabled
      void confirmMillifractionEnabled(!current, floatingShell)
    },
  })
  floatingWindow.once('ready-to-show', () => { floatingWindow.showInactive() })
  floatingWindow.on('focus', () => { publishTcc() })
  void floatingWindow.loadURL(`${SCHEME}://shell/floating.html`)
  const toolbar = createSelectionToolbarWindow(shellPreload)
  selectionController.setToolbarWindow(toolbar)
  toolbar.webContents.once('did-finish-load', () => { selectionController?.publishState() })
  void toolbar.loadURL(`${SCHEME}://shell/selection-toolbar.html`)
  selectionController.start()
  const ensureObservationFrameWindow = (): void => {
    if (observationFrameWindow !== undefined && !observationFrameWindow.isDestroyed()) return
    observationFrameWindow = createObservationFrameWindow()
    observationFrameWindow.once('closed', () => { observationFrameWindow = undefined })
    void observationFrameWindow.loadURL(`${SCHEME}://shell/observation-frame.html`)
  }
  const blurMainIfFocused = (): void => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed() || !window.isFocused()) return
    window.blur()
  }
  restoreOverlayGuard = (): void => {
    hideObservationFrame(observationFrameWindow)
    if (floatingShell !== undefined && !floatingShell.isDestroyed()) resetFloatingOverlayGuard(floatingShell)
    const toolbarWindow = selectionController.window()
    if (toolbarWindow !== undefined && !toolbarWindow.isDestroyed()) resetFloatingOverlayGuard(toolbarWindow)
    selectionController.setHidInput(false)
  }
  orbHostHandlers.onOverlayGuard = (event) => {
    if (floatingShell === undefined || floatingShell.isDestroyed()) return []
    applyFloatingOverlayGuard(floatingShell, event.mode, event.action)
    const toolbarWindow = selectionController.window()
    if (toolbarWindow !== undefined && !toolbarWindow.isDestroyed()) {
      applyFloatingOverlayGuard(toolbarWindow, event.mode, event.action)
    }
    if (event.mode === 'input') selectionController.setHidInput(event.action === 'begin')
    const ids = overlayWindowExcludeIds(floatingShell, toolbarWindow, observationFrameWindow)
    if (event.mode === 'input' && event.action === 'begin') {
      blurMainIfFocused()
      try {
        selectionController.restoreLastFrontApp()
      } catch (error: unknown) {
        // Restoring the previous app is separate from the cloak. A throw must not fail the Host ack.
        console.error('dsh desktop: restore front app failed', error)
      }
      return overlayGuardInputApplyDelay().then(() => ids)
    }
    return ids
  }
  orbHostHandlers.onObservationFrame = (event) => {
    if (event.bounds === null) {
      hideObservationFrame(observationFrameWindow)
      return
    }
    ensureObservationFrameWindow()
    if (observationFrameWindow === undefined || observationFrameWindow.isDestroyed()) return
    showObservationFrame(observationFrameWindow, event.bounds)
    raiseOverlayAboveObservationFrame(floatingShell, selectionController.window())
  }
  orbHostHandlers.onSckCapture = event => captureExcludedRegionOnElectron({
    region: event.region,
    excludeWindowIds: event.excludeWindowIds,
    output: event.output,
  })
  const shellSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== floatingWindow.webContents) throw new Error('dsh desktop: rejected floating IPC')
  }
  const shellDocumentSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender === floatingWindow.webContents) return
    const toolbar = selectionController?.window()
    if (toolbar !== undefined && !toolbar.isDestroyed() && event.sender === toolbar.webContents) return
    throw new Error('dsh desktop: rejected shell IPC')
  }
  ipcMain.handle(DESKTOP_IPC.floatingMove, (event, x: unknown, y: unknown, canDock: unknown) => {
    shellSender(event)
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('dsh desktop: invalid floating move')
    return moveFloatingBall(floatingWindow, x, y, canDock !== false)
  })
  ipcMain.handle(DESKTOP_IPC.floatingClamp, (event, canDock: unknown) => {
    shellSender(event)
    return clampFloatingWindow(floatingWindow, canDock !== false)
  })
  ipcMain.handle(DESKTOP_IPC.floatingUnsnap, (event) => {
    shellSender(event)
    return unsnapDockedBall(floatingWindow)
  })
  ipcMain.handle(DESKTOP_IPC.floatingSetExpanded, (event, expanded: unknown) => {
    shellSender(event)
    return setFloatingExpanded(floatingWindow, expanded === true)
  })
  ipcMain.handle(DESKTOP_IPC.floatingSessionGet, (event) => {
    shellSender(event)
    return readFloatingSessionId(paths.profile)
  })
  ipcMain.handle(DESKTOP_IPC.floatingSessionSet, (event, sessionId: unknown) => {
    shellSender(event)
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('dsh desktop: invalid floating session')
    writeFloatingSessionId(paths.profile, sessionId)
  })
  ipcMain.handle(DESKTOP_IPC.floatingOverlayModelGet, (event) => {
    shellSender(event)
    return readOrbAgentModels(paths.profile).overlay
  })
  ipcMain.handle(DESKTOP_IPC.floatingOverlayPermissionGet, (event) => {
    shellSender(event)
    return readOrbPermission(paths.profile)
  })
  ipcMain.handle(DESKTOP_IPC.floatingOrbWorkspace, (event) => {
    shellSender(event)
    ensureOrbWorkspaceDir(paths.orbWorkspace)
    return paths.orbWorkspace
  })
  ipcMain.handle(DESKTOP_IPC.floatingFocusMain, (event) => {
    shellSender(event)
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  })
  ipcMain.handle(DESKTOP_IPC.floatingQuit, (event) => {
    shellSender(event)
    app.quit()
  })
  ipcMain.handle(DESKTOP_IPC.floatingOverlayPermissionSet, (event, preset: unknown, sessionId: unknown) => {
    shellSender(event)
    if (!isOrbPermissionPreset(preset)) throw new Error('dsh desktop: overlay permission must be a known Access preset')
    writeOrbPermission(paths.profile, preset)
    const id = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
    backend.host?.sendOrb({ type: 'orb-permission', preset, ...(id === undefined ? {} : { sessionId: id }) })
  })
  ipcMain.handle(DESKTOP_IPC.floatingRunning, (event, running: unknown) => {
    shellSender(event)
    if (typeof running !== 'boolean') throw new Error('dsh desktop: floating running requires a boolean')
    selectionController?.setSessionRunning(running)
  })
  ipcMain.handle(DESKTOP_IPC.floatingEditing, (event, editing: unknown) => {
    shellSender(event)
    if (typeof editing !== 'boolean') throw new Error('dsh desktop: floating editing requires a boolean')
    overlayTextEditing = editing
  })
  ipcMain.handle(DESKTOP_IPC.floatingRestoreFront, (event) => {
    shellSender(event)
    if (selectionController?.isSessionRunning() !== true || overlayTextEditing) return
    selectionController.restoreFrontApp()
  })
  ipcMain.handle(DESKTOP_IPC.floatingAvatarGet, (event) => {
    shellSender(event)
    return orbAvatarUrl('shell', orbAvatarCacheToken(paths.profile))
  })
  ipcMain.handle(DESKTOP_IPC.floatingTccGet, (event) => {
    shellSender(event)
    return tcc.status()
  })
  ipcMain.handle(DESKTOP_IPC.floatingTccOpen, async (event, right: unknown) => {
    shellSender(event)
    if (!isTccRight(right)) throw new Error('dsh desktop: TCC right must be screen or accessibility')
    await tcc.open(right)
    return publishTcc()
  })
  ipcMain.handle(DESKTOP_IPC.floatingTccRelaunch, (event) => {
    shellSender(event)
    app.relaunch()
    app.quit()
  })
  ipcMain.handle(DESKTOP_IPC.floatingLocale, (event) => {
    shellDocumentSender(event)
    return currentDesktopLocale()
  })
  ipcMain.handle(DESKTOP_IPC.backendStatus, (event) => {
    shellDocumentSender(event)
    const state = backend.state
    return state.phase === 'error' ? { phase: 'error', message: state.message } : { phase: state.phase }
  })

  const requireSelectionToolbar = (event: IpcMainInvokeEvent): SelectionToolbarController => {
    assertDesktopSender(event, ['shell'])
    if (selectionController === undefined) throw new Error('dsh desktop: selection toolbar is unavailable')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null || window !== selectionController.window()) {
      throw new Error('dsh desktop: rejected selection IPC from an unowned renderer')
    }
    return selectionController
  }

  ipcMain.handle(DESKTOP_IPC.orbSupported, (event) => {
    assertProductSender(event)
    return orbSettingsSupported(process.platform)
  })
  ipcMain.handle(DESKTOP_IPC.orbSnapshot, (event) => {
    assertProductSender(event)
    return orbSnapshotFor('app')
  })
  ipcMain.handle(DESKTOP_IPC.orbPickAvatar, async (event) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['gif', 'png', 'webp'] }],
    }
    const picked = parent === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options)
    const filePath = picked.filePaths[0]
    if (picked.canceled || filePath === undefined) return { ok: false, error: 'cancelled' as const }
    const installed = installOrbAvatarFromPath(paths.profile, filePath)
    if (!installed.ok) return installed
    publishAvatar()
    return { ok: true as const, snapshot: orbSnapshotFor('app') }
  })
  ipcMain.handle(DESKTOP_IPC.orbRestoreAvatar, (event) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    restoreOrbAvatar(paths.profile)
    publishAvatar()
    return orbSnapshotFor('app')
  })
  ipcMain.handle(DESKTOP_IPC.orbSetOverlayModel, (event, selection: unknown) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    if (!isOrbAgentModelSelection(selection)) throw new Error('dsh desktop: overlay model selection is invalid')
    persistOverlayModel(selection)
  })
  ipcMain.handle(DESKTOP_IPC.orbSetBackgroundModel, (event, selection: unknown) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    if (!isOrbAgentModelSelection(selection)) throw new Error('dsh desktop: background model selection is invalid')
    persistBackgroundModel(selection)
  })
  ipcMain.handle(DESKTOP_IPC.orbSetSelectionEnabled, (event, enabled: unknown) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    if (typeof enabled !== 'boolean') throw new Error('dsh desktop: selection enablement requires a boolean')
    if (selectionController === undefined) throw new Error('dsh desktop: selection toolbar is unavailable')
    selectionController.setEnabled(enabled)
  })
  ipcMain.handle(DESKTOP_IPC.orbSetMillifractionEnabled, async (event, enabled: unknown) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    if (typeof enabled !== 'boolean') throw new Error('dsh desktop: millifraction enablement requires a boolean')
    const parent = BrowserWindow.fromWebContents(event.sender)
    return confirmMillifractionEnabled(enabled, parent === null ? undefined : parent)
  })
  ipcMain.handle(DESKTOP_IPC.orbOpenTcc, async (event, right: unknown) => {
    assertProductSender(event)
    assertOrbSettingsWritable(process.platform)
    if (!isTccRight(right)) throw new Error('dsh desktop: TCC right must be screen or accessibility')
    await tcc.open(right)
    publishTcc()
    return orbSnapshotFor('app')
  })
  ipcMain.handle(DESKTOP_IPC.selectionSearch, event => requireSelectionToolbar(event).search())
  ipcMain.handle(DESKTOP_IPC.selectionTranslate, (event) => { requireSelectionToolbar(event).translate() })
  ipcMain.handle(DESKTOP_IPC.selectionAttach, (event) => { requireSelectionToolbar(event).sendToAgent() })
  ipcMain.handle(DESKTOP_IPC.selectionSetLanguage, (event, language: unknown) => {
    if (language !== 'zh' && language !== 'en') throw new Error('dsh desktop: translate language must be zh or en')
    requireSelectionToolbar(event).setLanguage(language)
  })
  ipcMain.handle(DESKTOP_IPC.selectionInteract, (event) => { requireSelectionToolbar(event) })
  ipcMain.handle(DESKTOP_IPC.selectionSetContentSize, (event, size: unknown) => {
    if (typeof size !== 'object' || size === null || Array.isArray(size)) {
      throw new Error('dsh desktop: toolbar size requires width and height')
    }
    const record = size as { width?: unknown; height?: unknown }
    if (typeof record.width !== 'number' || typeof record.height !== 'number'
      || !Number.isFinite(record.width) || !Number.isFinite(record.height)
      || record.width < 1 || record.height < 1) {
      throw new Error('dsh desktop: toolbar size requires positive finite dimensions')
    }
    return requireSelectionToolbar(event).setContentSize(record.width, record.height)
  })

  installDesktopDirectoryPicker(() => mainWindow)
  installMicrophonePermissions(session.defaultSession, () => mainWindow?.webContents)

  ipcMain.handle(DESKTOP_IPC.boot, async (event) => {
    assertDesktopSender(event, ['app'])
    await startup
    if (backend.host === undefined || hostUrl === undefined) throw new Error('Desktop Host is unavailable')
    return { injections, streamBaseUrl: new URL(hostUrl).origin }
  })

  ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message: unknown) => {
    assertDesktopSender(event, ['app'])
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('dsh desktop: rejected startup failure from a non-primary frame')
    }
    if (typeof message !== 'string') throw new Error('dsh desktop: startup failure must be text')
    reportFatal(new Error(message), 'web-boot')
  })

  ipcMain.handle(DESKTOP_IPC.browserAcquire, (event, workspace: unknown) => {
    assertProductSender(event)
    return browserGuests.acquire(event.sender, workspace)
  })
  ipcMain.handle(DESKTOP_IPC.browserRelease, (event, lease: unknown) => {
    assertProductSender(event)
    return browserGuests.release(event.sender, lease)
  })

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    const ownedWebContents = details.webContentsId === mainWindow?.webContents.id
      || details.webContentsId === floatingShell?.webContents.id
    if (hostUrl === undefined || hostCookie === undefined || !ownedWebContents) {
      callback({})
      return
    }
    const target = new URL(hostUrl)
    const requested = new URL(details.url)
    if (requested.host !== target.host) { callback({}); return }
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
    if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }
    callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
  })

  const assertMainApplication = (event: IpcMainInvokeEvent): BrowserWindow => {
    const owner = mainWindow
    if (owner === undefined || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected Platform command')
    return owner
  }
  ipcMain.on(PLATFORM_IPC.bootstrap, (event) => {
    try { event.returnValue = platformView.bootstrap(event) }
    catch { event.returnValue = null }
  })
  ipcMain.handle(PLATFORM_IPC.open, (event, page: unknown, bounds: unknown) => {
    const owner = assertMainApplication(event)
    if (page !== 'usage' && page !== 'top-up') throw new Error('Invalid Platform page')
    return platformView.open(owner, page, platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.bounds, (event, bounds: unknown) => {
    assertMainApplication(event)
    platformView.setBounds(platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.close, (event) => { assertMainApplication(event); platformView.close() })
  // Only the main window may synchronize its palette with the native material.
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
  })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, async (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin) {
      throw new Error('desktop welcome: rejected locale request from an unowned frame')
    }
    if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return { languages: systemLanguages, preference: await welcomeBackend.readLocalePreference() }
  })
  ipcMain.on(DESKTOP_IPC.localeChanged, (event, next: unknown) => {
    const window = mainWindow
    if (window === undefined || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || typeof next !== 'string') return
    const current = resolveDesktopStartupLocale(next, systemLanguages)
    if (current.id === locale.id) return
    locale = current
    platformView.notifyLocaleChanged()
    windowsLanguage = locale.id
    installMenu()
  })
  ipcMain.handle(DESKTOP_IPC.updatesStatus, (event) => {
    assertProductSender(event)
    return presentDesktopUpdate(updates.state)
  })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, async (event) => {
    assertProductSender(event)
    await openUpdatePrompt()
  })

  let promptOperation: Promise<void> | undefined
  let policyAuthenticationQueued = false
  const openUpdatePrompt = (manual = false): Promise<void> => {
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
    }
    let failedOperation: 'check' | 'download' | 'install' = 'check'
    promptOperation ??= Promise.resolve().then(async () => {
      if (manual) updateJournal?.action('check-requested')
      const joinedPolicyAuthentication = authenticationOperation !== undefined
      if (joinedPolicyAuthentication) await authenticatePolicy()
      if (isMandatory()) {
        mandatoryUI?.focus()
        if (manual) await Promise.all([checkPolicyManually(), updateSchedule.check(true)])
        return
      }
      let controller: AbortController | undefined
      let progress: Promise<unknown> | undefined
      try {
        let state = updates.state
        if (manual || state.phase === 'idle' || (state.phase === 'error' && state.failedOperation === 'check')) {
          controller = new AbortController()
          ordinaryDialogs.add(controller)
          const parent = currentDialogWindow()
          progress = parent === undefined ? Promise.resolve() : updateDialog.show(parent, { type: 'info', title: locale.messages.updateCheckTitle,
            message: locale.messages.updateChecking, buttons: [locale.messages.later], cancelId: 0, signal: controller.signal })
          if (!joinedPolicyAuthentication) {
            void checkPolicyManually('deferred').catch((error: unknown) => { console.error(error) })
          }
          state = await updateSchedule.check(true)
        }
        if (isMandatory()) { mandatoryUI?.focus(); return }
        if (state.phase === 'error' && state.failedOperation === 'check') { await showUpdateFailure(state); return }
        if (state.phase === 'idle') {
          await ordinaryMessageBox({ type: 'info', title: locale.messages.updateCheckTitle,
            message: formatDesktopMessage(locale.messages.updateCurrent, { version: app.getVersion() }) })
          return
        }
        if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {
          if (state.version !== undefined) {
            failedOperation = 'install'
            await showUpdateFailure(await updates.install(state.version))
          }
          return
        }
        if (state.phase !== 'available' && !(state.phase === 'error' && state.failedOperation === 'download')) return
        if (manual) {
          const result = await ordinaryMessageBox({ title: locale.messages.updateCheckTitle, message: locale.messages.updateAvailable,
            detail: formatDesktopMessage(locale.messages.updateDetail, { version: state.version ?? '' }),
            buttons: [locale.messages.updateDownload], cancelId: 1 })
          if (result.response !== 0) return
        }
        if (!isMandatory() && state.version !== undefined) {
          controller?.abort()
          failedOperation = 'download'
          await showUpdateFailure(await downloadUpdate(state.version))
        }
      } finally {
        controller?.abort()
        if (controller !== undefined) ordinaryDialogs.delete(controller)
        await progress
      }
    }).catch((error: unknown) => showUpdateFailure({ phase: 'error', failedOperation,
      message: desktopErrorState(error).message }))
      .finally(() => { promptOperation = undefined; flushQueuedPolicyAuthentication() })
    return promptOperation
  }

  let authenticationOperation: Promise<DesktopPolicyState | undefined> | undefined
  const authenticatePolicy = () => {
    if (authenticationOperation !== undefined) { policyAuth?.focus(); updateDialog.focus() }
    authenticationOperation ??= runPolicyAuthentication().finally(() => { authenticationOperation = undefined })
    return authenticationOperation
  }
  const flushQueuedPolicyAuthentication = (): void => {
    if (!policyAuthenticationQueued || promptOperation !== undefined || authenticationOperation !== undefined
      || isMandatory() || quitting) return
    policyAuthenticationQueued = false
    void authenticatePolicy().catch((error: unknown) => { console.error(error) })
  }
  const queuePolicyAuthentication = (): void => {
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
      return
    }
    policyAuthenticationQueued = true
    flushQueuedPolicyAuthentication()
  }
  const runPolicyAuthentication = async () => {
    if (policyAuth === undefined || mandatoryPolicy === undefined || quitting) return undefined
    const parent = mandatoryUI?.confirmationWindow ?? currentDialogWindow()
    if (parent === undefined) return undefined
    const consent = await updateDialog.show(parent, { type: 'info', title: locale.messages.policyLoginTitle,
      message: locale.messages.policyLoginRequired, buttons: [locale.messages.policyLogin, locale.messages.later], cancelId: 1 })
    if (consent.response !== 0 || isQuitting()) return undefined
    const outcome = await policyAuth.login()
    if (isQuitting() || outcome === 'cancelled') return undefined
    if (outcome === 'failed') {
      await updateDialog.show(parent, { type: 'error', title: locale.messages.policyLoginTitle,
        message: locale.messages.policyLoginFailed, buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
      return undefined
    }
    // Drain a pre-login request before asking the server to evaluate the new cookies.
    await mandatoryPolicy.check('login-return')
    if (isQuitting()) return undefined
    return mandatoryPolicy.check('login-return', true)
  }

  const checkPolicyManually = async (authentication: 'immediate' | 'deferred' = 'immediate') => {
    if (authenticationOperation !== undefined) return authenticatePolicy()
    const policy = await mandatoryPolicy?.check('manual', true)
    if (policy?.error !== 'authentication-required') return policy
    if (authentication === 'immediate') return authenticatePolicy()
    queuePolicyAuthentication()
    return policy
  }

  const automaticCheck = (): void => {
    if (!quitting) void mandatoryPolicy?.check('foreground-or-resume').catch((error: unknown) => { console.error(error) })
    if (!quitting) void updateSchedule.check().catch((error: unknown) => { console.error(error) })
  }
  powerMonitor.on('resume', automaticCheck)
  app.on('will-quit', () => {
    updateSchedule.dispose()
    powerMonitor.off('resume', automaticCheck)
    updates.dispose()
  })

  app.setAboutPanelOptions({
    applicationName: 'DeepSeek Orb',
    applicationVersion: app.getVersion(),
    // The release has no separate build number; omit Electron's bundle version.
    version: '',
    copyright: '',
    iconPath: development ? join(app.getAppPath(), 'resources', 'icon-windows.png')
      : join(process.resourcesPath, 'icon.png'),
  })
  // A custom application menu replaces Electron's default menu, so macOS needs
  // its standard menus and application hide commands declared explicitly.
  // Keep app.name stable: Electron derives its default userData directory from it.
  const darwin = process.platform === 'darwin'
  const platformMenus: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
    : [{ role: 'editMenu' }]
  const hideCommands: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'hide', label: currentDesktopLocale().messages.hideApplication },
      { role: 'hideOthers', label: currentDesktopLocale().messages.hideOtherApplications },
      { role: 'unhide', label: currentDesktopLocale().messages.showAllApplications }, { type: 'separator' }]
    : []
  const applicationItems = (): MenuItemConstructorOptions[] => [
    // Windows has no system About panel; Electron's fallback is a plain
    // message box, so the shell shows its own dimmed dialog instead.
    process.platform === 'win32'
      ? { label: currentDesktopLocale().messages.aboutMenu,
        click: () => { void showAbout().catch((error: unknown) => { console.error(error) }) } }
      : { label: currentDesktopLocale().messages.aboutMenu, role: 'about' },
    { type: 'separator' },
    { label: currentDesktopLocale().messages.checkUpdatesMenu, click: () => { void openUpdatePrompt(true) } },
    ...development ? [
      { type: 'separator' as const },
      { label: currentDesktopLocale().messages.reloadPageMenu, role: 'reload' as const },
      { label: currentDesktopLocale().messages.restartAppHostMenu, click: () => {
        if (quitting) return
        app.relaunch()
        app.quit()
      } },
    ] : [],
    { type: 'separator' },
    ...hideCommands,
    { role: 'quit', ...(darwin ? { label: currentDesktopLocale().messages.quitApplication }
      : process.platform === 'win32' ? { label: currentDesktopLocale().messages.exitApplication } : {}) },
  ]
  const devToolsItems: MenuItemConstructorOptions[] = [
    { role: 'toggleDevTools', visible: false },
    { role: 'toggleDevTools', visible: false, accelerator: 'F12' },
  ]
  const installMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'win32' ? devToolsItems : [{
      label: darwin ? app.name : currentDesktopLocale().messages.application,
      submenu: [...applicationItems(), ...devToolsItems],
    }, ...platformMenus]))
  }
  installMenu()

  if (process.platform === 'win32') {
    ipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name: unknown, x: unknown, y: unknown) => {
      assertDesktopSender(event, ['app'])
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('desktop menu: rejected sender')
      if ((name !== 'application' && name !== 'edit')
        || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('desktop menu: invalid popup request')
      const window = mainWindow
      // Editor-owned history listens to key events rather than Chromium's native undo stack.
      const editItem = (label: string, keyCode: string, modifiers: Array<'control'>, accelerator?: string): MenuItemConstructorOptions => ({
        label,
        ...(accelerator === undefined ? {} : { accelerator }),
        click: () => {
          window.webContents.focus()
          window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
          window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        },
      })
      const items: MenuItemConstructorOptions[] = name === 'application' ? applicationItems() : [
        editItem(currentDesktopLocale().messages.undo, 'Z', ['control'], 'Ctrl+Z'),
        editItem(currentDesktopLocale().messages.redo, 'Y', ['control'], 'Ctrl+Y'),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.cut, 'X', ['control'], 'Ctrl+X'),
        editItem(currentDesktopLocale().messages.copy, 'C', ['control'], 'Ctrl+C'),
        editItem(currentDesktopLocale().messages.paste, 'V', ['control'], 'Ctrl+V'),
        editItem(currentDesktopLocale().messages.delete, 'Delete', []),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.selectAll, 'A', ['control'], 'Ctrl+A'),
      ]
      const zoom = mainWindow.webContents.getZoomFactor()
      return new Promise<void>((resolve) => {
        Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve })
      })
    })
    ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language: unknown, color: unknown, symbolColor: unknown) => {
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) return
      if (!event.senderFrame.url.startsWith(`${SCHEME}://app/`)) return
      if (typeof language === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(language)) {
        windowsLanguage = language
      }
      // Empty colors precede client stylesheet installation; only CSS color values cross IPC.
      const validColor = (value: unknown): value is string => typeof value === 'string'
        && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
      if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({ color, symbolColor })
    })
  }

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, false, true)
    mainWindow = window
    browserGuests.bind(window)
    window.on('focus', automaticCheck)
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error') return
      rendererConsole.push(`${details.sourceId}:${String(details.lineNumber)} ${details.message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !quitting && !window.isDestroyed()) {
        reportFatal(new Error(`Desktop page failed to load: ${url} (${String(code)}: ${description})`), 'renderer')
      }
    })
    window.webContents.on('preload-error', (_event, _path, error) => {
      if (!quitting && !window.isDestroyed()) reportFatal(error, 'renderer')
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      navigation = undefined
      if (!quitting && !window.isDestroyed() && details.reason !== 'clean-exit') {
        reportFatal(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
      }
    })
    return window
  }
  const enterWorkspace = async (): Promise<void> => {
    if (quitting) return
    const window = mainWindow ?? createMainWindow()
    await navigateMain(applicationUrl)
    if (isQuitting() || recovery.active || window.isDestroyed()) return
    window.show()
    enteredWorkspace = true
    if (welcomeWindow !== undefined) {
      welcomeWindow.close()
      window.webContents.send(DESKTOP_IPC.enterWorkspace)
    }
    welcomeWindow = undefined
    if (development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  }
  let openingWelcome: Promise<void> | undefined
  const showWelcome = (): Promise<void> => {
    if (quitting) return Promise.resolve()
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show()
      welcomeWindow.focus()
      return Promise.resolve()
    }
    openingWelcome ??= (async () => {
      welcomeWindow = await openWelcomeWindow(locale, {
        startSignIn: async () => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.start(locale.id)
        },
        cancelSignIn: async (id) => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.cancel(id)
        },
        copySignInLink: async (id) => {
          const state = await welcomeBackend?.account.state()
          if (state?.attempt?.id !== id || state.attempt.phase !== 'waiting-browser' || state.attempt.authorizeUrl === undefined) {
            throw new Error('desktop welcome: login link is unavailable')
          }
          await clipboard.writeText(platformLoginUrl(state.attempt.authorizeUrl))
        },
        saveApiKey: async (apiKey) => {
          if (backend.host === undefined || welcomeBackend === undefined) return { ok: false }
          const saved = await welcomeBackend.save(apiKey)
          if (!saved.ok) return saved
          await enterWorkspace()
          return { ok: true }
        },
        skip: enterWorkspace,
      })
      const window = welcomeWindow
      window.once('closed', () => {
        void welcomeBackend?.account.state().then((state) => {
          if (state.attempt !== null && !enteredWorkspace) return welcomeBackend?.account.cancel(state.attempt.id)
          return undefined
        }).catch(() => undefined)
      })
      window.once('closed', () => {
        if (welcomeWindow === window) welcomeWindow = undefined
        if (!enteredWorkspace && !recovery.active) mainWindow?.close()
      })
      if (isQuitting() || recovery.active || enteredWorkspace) window.close()
      else mainWindow?.hide()
    })().finally(() => { openingWelcome = undefined })
    return openingWelcome
  }
  const openInitialWindow = async (): Promise<void> => {
    if (quitting || recovery.active) return
    const state = await readWelcomeState()
    if (isQuitting() || backend.state.phase !== 'ready') return
    locale = resolveDesktopStartupLocale(state.localePreference, systemLanguages)
    windowsLanguage = locale.id
    installMenu()
    if (!enteredWorkspace && needsWelcome({ loggedIn: state.loggedIn, hasApiKey: state.hasApiKey })) {
      await showWelcome()
    } else {
      await enterWorkspace()
    }
  }
  focusPrimaryWindow = () => {
    if (quitting) return
    if (isMandatory()) { mandatoryUI?.focus(); return }
    const window = welcomeWindow ?? mainWindow
    if (window === undefined || window.isDestroyed()) {
      try { createMainWindow() } catch (error) { reportFatal(error, 'main'); return }
      void (backend.state.phase === 'ready' ? openInitialWindow() : navigateMain(applicationUrl)).catch((error: unknown) => { reportFatal(error, 'main') })
      return
    }
    // Startup and sign-out select the visible window before activation may reveal the workspace.
    if (window === mainWindow && !enteredWorkspace) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  if (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === '1') app.setAsDefaultProtocolClient('dsh')
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url === 'dsh://open' || url === 'dsh://open/') focusPrimaryWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      focusPrimaryWindow()
      return
    }
    if (!pointInWindow(floatingShell, screen.getCursorScreenPoint())) return
    if (selectionController.isSessionRunning() !== true || overlayTextEditing) return
    blurMainIfFocused()
    selectionController.restoreLastFrontApp()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    shuttingDown = true
    updateJournal?.action('quit-requested')
    if (shellInstallerOwnsQuit) {
      updateDialog.dispose()
      mandatoryUI?.dispose()
      return
    }
    if (quitting) return
    event.preventDefault()
    quitting = true
    selectionController?.stop()
    stopAccount?.()
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.hide()
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.hide()
    updateSchedule.dispose()
    updateDialog.dispose()
    mandatoryUI?.dispose()
    void Promise.all([Promise.resolve(mandatoryPolicy?.dispose()).then(() => policyAuth?.dispose()), backend.close()])
      .catch((error: unknown) => { console.error(error) }).finally(() => { app.quit() })
  })

  mainWindow = createMainWindow()
  const manifest: unknown = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop policy: invalid application manifest')
  const developmentPolicy = app.isPackaged ? undefined : process.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG
  const policyInput: unknown = app.isPackaged
    ? ('dshMandatoryUpdatePolicy' in manifest ? manifest.dshMandatoryUpdatePolicy : undefined)
    : developmentPolicy === undefined ? undefined : JSON.parse(developmentPolicy) as unknown
  const policyConfig = resolveDesktopPolicyConfig(policyInput, !app.isPackaged)
  if (policyConfig !== undefined) {
    if (policyConfig.authentication === 'feishu-test') {
      policyAuth = new DesktopPolicyTestAuth(policyConfig.origin, policyConfig.allowedAuthOrigins, locale,
        () => mandatoryUI?.confirmationWindow ?? currentDialogWindow(),
        (event) => { console.info(`desktop policy authentication: ${event}`); updateJournal?.action(`policy-login-${event}`) })
    }
    const bundleId = app.isPackaged
      ? ('dshDesktopAppId' in manifest ? manifest.dshDesktopAppId : undefined)
      : process.env.DSH_DESKTOP_APP_ID
    if (typeof bundleId !== 'string' || bundleId.trim() === '') throw new Error('desktop policy: missing application bundle ID')
    if (!['win32', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('desktop policy: unsupported platform')
    let wasBlocking = false
    mandatoryPolicy = new DesktopMandatoryUpdatePolicy(policyConfig, {
      platform: process.platform as 'win32' | 'darwin', arch: process.arch as 'x64' | 'arm64',
      version: app.getVersion(), bundledDshVersion: app.isPackaged ? readDesktopRuntime(resources.dsh).release.version : app.getVersion(),
      bundleId, locale: locale.id,
    }, (state) => {
      if (state.error !== 'authentication-required') policyAuthenticationQueued = false
      if (state.blocking) {
        for (const controller of ordinaryDialogs) controller.abort()
        if (!wasBlocking) updateDialog.cancel()
      }
      mandatoryUI?.sync()
      if (state.blocking && !wasBlocking) void updateSchedule.check(false, true).catch((error: unknown) => { console.error(error) })
      wasBlocking = state.blocking
    }, policyAuth?.request)
    const policy = mandatoryPolicy
    mandatoryUI = new DesktopMandatoryUpdateWindow({
      preload: fileURLToPath(new URL('./preload-mandatory.cjs', import.meta.url)), locale,
      allowedPageOrigins: policyConfig.allowedPageOrigins, parent: () => mainWindow,
      policy: () => policy.state, update: () => updates.state,
      refresh: async () => { await Promise.all([checkPolicyManually(), updateSchedule.check(true)]) },
      download: downloadUpdate, install: version => updates.install(version),
    })
    void mandatoryPolicy.check('launch').then((state) => {
      if (app.isPackaged && state.error === 'authentication-required' && !isQuitting()) queuePolicyAuthentication()
    }).catch((error: unknown) => { console.error(error) })
  }
  automaticCheck()
  await reconcileBackend().catch(() => undefined)
  // Window lifecycle callbacks run while backend startup is pending.
  if (isQuitting()) return
  const window = currentMainWindow()
  if (window !== undefined && development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    window.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  reportFatal(error, 'main')
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
