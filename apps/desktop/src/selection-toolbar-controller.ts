/** Orchestrate the Darwin selection helper, toolbar window, and overlay prompts. */

import type { BrowserWindow } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { SelectionHelperEvent, SelectionMonitor, SelectionMonitorHandlers } from './selection-monitor.ts'
import { startSelectionMonitor } from './selection-monitor.ts'
import {
  composeSelectionTranslatePrompt,
  selectionSearchUrl,
  type SelectionTranslateLanguage,
} from './selection-prompt.ts'
import {
  hideSelectionToolbar,
  pointInWindow,
  selectionToolbarBounds,
  selectionToolbarMenuBounds,
  showSelectionToolbar,
} from './selection-toolbar-window.ts'
import {
  readSelectionToolbarConfig,
  writeSelectionToolbarConfig,
  type SelectionToolbarConfig,
} from './selection-toolbar-config.ts'

/** Ignore a repeated pid+bundle+text selection within this window. */
export const SELECTION_DEDUPE_MS = 3_000

/** Delay before a second front-app restore so Chromium's delayed activation does not keep Desktop key. */
export const SELECTION_RESTORE_FRONT_MS = 80

/** Host-owned actions the toolbar controller must not import from Electron main. */
export interface SelectionToolbarHost {
  readonly electronPid: number
  /** Open the Bing search URL in the default browser. */
  openExternal(url: string): Promise<void>
  /** Send composed user-message text to the overlay renderer. */
  promptOverlay(text: string): void
  /** Attach selected text to the overlay composer without prompting. */
  attachOverlay(text: string): void
  /** Prompt macOS Accessibility TCC; returns whether the process is trusted. */
  requestAccessibility(): boolean
  /** Test override; production uses {@link startSelectionMonitor}. */
  startMonitor?(handlers: SelectionMonitorHandlers): SelectionMonitor | undefined
  /** Test clock; production uses `Date.now`. */
  now?(): number
}

/**
 * Desktop-owned selection toolbar: helper events, profile JSON, Bing search, and overlay prompts.
 */
export class SelectionToolbarController {
  private config: SelectionToolbarConfig
  private monitor: SelectionMonitor | undefined
  private toolbar: BrowserWindow | undefined
  private lastText = ''
  private lastAnchor = { x: 0, y: 0 }
  private lastBarOrigin = { x: 0, y: 0 }
  private lastDedupe: { key: string; at: number } | undefined
  private lastPid: number | undefined
  private restoreTimer: ReturnType<typeof setTimeout> | undefined
  private sessionRunning = false
  private hidInput = false
  private promptedAccessibility = false

  /**
   * @param profileDir - Desktop profile directory holding `selection-toolbar.json`.
   * @param host - Electron actions kept out of this module's import graph for tests.
   */
  constructor(
    private readonly profileDir: string,
    private readonly host: SelectionToolbarHost,
  ) {
    this.config = readSelectionToolbarConfig(profileDir)
  }

  /** @returns whether the toolbar is enabled in the profile. */
  enabled(): boolean {
    return this.config.enabled
  }

  /** @returns the persisted translate target. */
  language(): SelectionTranslateLanguage {
    return this.config.translateTargetLanguage
  }

  /** @returns the live toolbar window, if created. */
  window(): BrowserWindow | undefined {
    return this.toolbar
  }

  /**
   * Bind the no-activate toolbar window. The caller loads `selection-toolbar.html`.
   * @param window - panel created by `createSelectionToolbarWindow`.
   */
  setToolbarWindow(window: BrowserWindow): void {
    this.toolbar = window
    window.once('closed', () => { this.toolbar = undefined })
  }

  /** Spawn the Darwin helper when the toolbar is enabled. */
  start(): void {
    if (!this.config.enabled || this.monitor !== undefined) return
    const start = this.host.startMonitor ?? startSelectionMonitor
    this.monitor = start({ onEvent: (event) => { this.onHelperEvent(event) } })
    this.monitor?.setExcludePids([this.host.electronPid])
  }

  /** Kill the helper and hide the toolbar. */
  stop(): void {
    this.monitor?.stop()
    this.monitor = undefined
    if (this.restoreTimer !== undefined) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = undefined
    }
    hideSelectionToolbar(this.toolbar)
  }

  /**
   * Persist enablement and start or stop the helper.
   * @param enabled - whether the toolbar should read selections.
   */
  setEnabled(enabled: boolean): void {
    this.writeConfig({ ...this.config, enabled })
    if (this.config.enabled) this.start()
    else this.stop()
  }

  /** Persist the inverse of {@link enabled} and start or stop the helper. */
  toggle(): void {
    this.setEnabled(!this.config.enabled)
  }

  /**
   * Persist the translate target and push it to the toolbar renderer.
   * @param language - Chinese or English.
   */
  setLanguage(language: SelectionTranslateLanguage): void {
    this.writeConfig({ ...this.config, translateTargetLanguage: language })
    this.publishState()
  }

  /** Send the current language to the toolbar renderer. */
  publishState(): void {
    if (this.toolbar === undefined || this.toolbar.isDestroyed()) return
    this.toolbar.webContents.send(DESKTOP_IPC.selectionState, {
      language: this.config.translateTargetLanguage,
    })
  }

  /**
   * Hide and skip reads while the overlay Computer Use session is running.
   * @param running - overlay `session/list` running flag.
   */
  setSessionRunning(running: boolean): void {
    this.sessionRunning = running
    if (running) hideSelectionToolbar(this.toolbar)
  }

  /** @returns whether the overlay Computer Use session is running. */
  isSessionRunning(): boolean {
    return this.sessionRunning
  }

  /**
   * Last frontmost process that is not this Electron app.
   * @returns the pid, or undefined when the monitor has not seen another app.
   */
  lastFrontPid(): number | undefined {
    const pid = this.monitor?.lastFrontPid()
    if (pid === undefined || pid === this.host.electronPid) return undefined
    return pid
  }

  /**
   * Re-activate the app that was frontmost before this Electron app.
   * A running overlay click uses this so Computer Use does not observe the main window.
   */
  restoreLastFrontApp(): void {
    const pid = this.lastFrontPid()
    if (pid === undefined) return
    this.monitor?.activatePid(pid)
  }

  /**
   * Hide and skip reads during overlay-guard HID so Cmd+C cannot fight `input_text`.
   * @param active - whether an `input` begin is still unmatched.
   */
  setHidInput(active: boolean): void {
    this.hidInput = active
    if (active) hideSelectionToolbar(this.toolbar)
  }

  /**
   * Open Bing for the last selection. Does not expand the overlay.
   * @returns after `openExternal` settles, or immediately when there is no text.
   */
  async search(): Promise<void> {
    if (this.lastText === '') return
    hideSelectionToolbar(this.toolbar)
    await this.host.openExternal(selectionSearchUrl(this.lastText))
  }

  /**
   * Grow or shrink the toolbar window to the renderer-measured content.
   * Extra height exists only while the language menu is open so transparent chrome does not eat clicks.
   * @param width - content width in CSS pixels.
   * @param height - content height in CSS pixels, including an open language menu.
   * @returns whether the menu is laid out above the bar.
   */
  setContentSize(width: number, height: number): { menuAbove: boolean } {
    if (this.toolbar === undefined || this.toolbar.isDestroyed()) return { menuAbove: false }
    const bounds = selectionToolbarMenuBounds(this.lastBarOrigin, { width, height })
    this.toolbar.setBounds(bounds)
    return { menuAbove: bounds.y < this.lastBarOrigin.y }
  }

  /** Prompt the overlay Computer Use session to translate the last selection. */
  translate(): void {
    this.promptSelection(composeSelectionTranslatePrompt(this.lastText, this.config.translateTargetLanguage))
  }

  /** Attach the last selection to the overlay composer. Does not prompt or restore the front app. */
  sendToAgent(): void {
    if (this.lastText === '') return
    this.host.attachOverlay(this.lastText)
  }

  /**
   * Make the app that owned the last selection key again.
   * Translate calls this so Desktop does not stay the frontmost app.
   */
  restoreFrontApp(): void {
    const pid = this.lastPid
    if (pid === undefined || pid === this.host.electronPid) return
    this.monitor?.activatePid(pid)
  }

  /**
   * Apply one NDJSON helper event. Tests inject events without spawning the binary.
   * @param event - parsed helper payload.
   */
  onHelperEvent(event: SelectionHelperEvent): void {
    switch (event.type) {
      case 'ready':
        this.monitor?.setExcludePids([this.host.electronPid])
        return
      case 'untrusted':
        if (this.promptedAccessibility) return
        this.promptedAccessibility = true
        this.host.requestAccessibility()
        return
      case 'mouse-down':
        if (!pointInWindow(this.toolbar, event)) hideSelectionToolbar(this.toolbar)
        return
      case 'key':
      case 'dismiss':
        hideSelectionToolbar(this.toolbar)
        return
      case 'mouse-up':
        this.lastAnchor = { x: event.x, y: event.y }
        return
      case 'selection':
        this.onSelection(event)
        return
    }
  }

  private pausedReads(): boolean {
    return this.sessionRunning || this.hidInput || !this.config.enabled
  }

  private writeConfig(config: SelectionToolbarConfig): void {
    this.config = config
    writeSelectionToolbarConfig(this.profileDir, config)
  }

  private promptSelection(text: string): void {
    if (this.lastText === '') return
    this.host.promptOverlay(text)
    this.scheduleRestoreFrontApp()
  }

  private scheduleRestoreFrontApp(): void {
    this.restoreFrontApp()
    if (this.restoreTimer !== undefined) clearTimeout(this.restoreTimer)
    const timer = setTimeout(() => {
      this.restoreTimer = undefined
      this.restoreFrontApp()
    }, SELECTION_RESTORE_FRONT_MS)
    timer.unref()
    this.restoreTimer = timer
  }

  private onSelection(event: Extract<SelectionHelperEvent, { type: 'selection' }>): void {
    if (this.pausedReads() || this.toolbar === undefined) return
    const key = `${String(event.pid ?? 0)}\0${event.bundle ?? ''}\0${event.text}`
    const now = (this.host.now ?? Date.now)()
    if (this.lastDedupe !== undefined && this.lastDedupe.key === key && now - this.lastDedupe.at < SELECTION_DEDUPE_MS) {
      return
    }
    this.lastDedupe = { key, at: now }
    this.lastText = event.text
    this.lastPid = event.pid
    if (event.x !== undefined && event.y !== undefined) this.lastAnchor = { x: event.x, y: event.y }
    const bounds = selectionToolbarBounds(this.lastAnchor)
    this.lastBarOrigin = { x: bounds.x, y: bounds.y }
    showSelectionToolbar(this.toolbar, bounds)
    this.publishState()
  }
}
