/** Launch the Desktop profile through the Web application and report its URL to Electron. */

import { delimiter, join } from 'node:path'
import { inspect } from 'node:util'
import { loadLayeredEnv, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopOffice from './office.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'
import { installPlatformSessionPublisher } from './platform-session.ts'
import { installOfficeEngineResolution } from './office-engine.ts'
import {
  clearOverlayGuardTransport,
  completeObservationFrameAck,
  completeOverlayGuardAck,
  completeSckCaptureAck,
  setOverlayGuardTransport,
} from './computer-use-overlay-guard.ts'
import * as computerUseOverlayGuard from './computer-use-overlay-guard.ts'
import * as computerUseOrbPermission from './computer-use-orb-permission.ts'
import { setOrbPermissionPreset, isOrbPermissionPreset } from './computer-use-orb-permission.ts'
import * as computerUseOrbCoordinateMode from './computer-use-orb-coordinate-mode.ts'
import { setOrbCoordinateMode } from './computer-use-orb-coordinate-mode.ts'
import * as computerUseOrbCodeAgentModel from './computer-use-orb-code-agent-model.ts'
import { setOrbCodeAgentModelSelection } from './computer-use-orb-code-agent-model.ts'
import { existsSync } from 'node:fs'

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  installOfficeEngineResolution(runtimeDir)
  const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor },
    patchFiles: existsSync(process.env.DSH_COMPUTER_USE_PATCH ?? '') ? [process.env.DSH_COMPUTER_USE_PATCH as string] : [],
    args: ['--no-open', '--port', '19387'],
    ...(process.argv[5] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[5]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[6] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: { updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl> } = {}
  const send = (message: object): Promise<void> => new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) { resolve(); return }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
  })
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    clearOverlayGuardTransport(new Error('dsh desktop: Host is stopping'))
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  setOverlayGuardTransport((event) => { void send(event) })
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type === 'overlay-guard-ack' && 'requestId' in message && typeof message.requestId === 'number') {
      const ids = 'excludeWindowIds' in message && Array.isArray(message.excludeWindowIds)
        ? message.excludeWindowIds.filter((id): id is number => typeof id === 'number')
        : []
      completeOverlayGuardAck(message.requestId, ids)
      return
    }
    if (message.type === 'observation-frame-ack' && 'requestId' in message && typeof message.requestId === 'number') {
      completeObservationFrameAck(message.requestId)
      return
    }
    if (message.type === 'sck-capture-ack' && 'requestId' in message && typeof message.requestId === 'number') {
      completeSckCaptureAck(message.requestId, 'error' in message && typeof message.error === 'string' ? message.error : undefined)
      return
    }
    if (message.type === 'orb-permission' && 'preset' in message && isOrbPermissionPreset(message.preset)) {
      setOrbPermissionPreset(message.preset, 'sessionId' in message && typeof message.sessionId === 'string' ? message.sessionId : undefined)
      return
    }
    if (message.type === 'orb-coordinate-mode' && 'mode' in message && (message.mode === 'millifraction' || message.mode === 'pixel')) {
      setOrbCoordinateMode(message.mode)
      return
    }
    if (message.type === 'orb-code-agent-model' && 'provider' in message && 'model' in message
      && typeof message.provider === 'string' && typeof message.model === 'string') {
      setOrbCodeAgentModelSelection({
        provider: message.provider,
        model: message.model,
        ...('reasoningEffort' in message && typeof message.reasoningEffort === 'string' ? { reasoningEffort: message.reasoningEffort } : {}),
      })
      return
    }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  await ctx.plugin(computerUseOverlayGuard)
  await ctx.plugin(computerUseOrbPermission)
  await ctx.plugin(computerUseOrbCoordinateMode)
  await ctx.plugin(computerUseOrbCodeAgentModel)
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  await ctx.plugin(desktopOffice, {
    runtimeDir,
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  installPlatformSessionPublisher(ctx, (session) => {
    if (process.connected) process.send?.({ type: 'platform-session', session })
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  if (process.connected) process.send?.({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() }, (error) => { if (error !== null) console.error(error) })
}

/** Upper bound of the startup diagnostic carried over IPC; the head holds the message and stack. */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    // The shell receives the complete inspected error here, not through stderr:
    // stderr bytes and this IPC message race, and the shell reports the first
    // failure it sees.
    const diagnostic = inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS)
    if (process.connected) process.send?.({ type: 'fatal', message, diagnostic }, (error) => { if (error !== null) console.error(error) })
    console.error(error)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
