/**
 * Desktop Host services consumed by third-party Plugin Market plugins.
 * Provided before Loader entries so `ctx.inject(['desktopPnpm'])` resolves.
 * @module @deepseek-ai/dsh-desktop-host/desktop-plugin-services
 */

import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'

/** Structural Desktop profile locator consumed by dsh-market. */
export interface DesktopProfiles {
  readonly current: {
    readonly name: string
    readonly dir: string
  }
}

/** One Host-alive package operation as consumed by dsh-market. */
export interface DesktopPnpmHandle {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }>
  cancel(): void
}

/** Package-operation service consumed by dsh-market on Desktop. */
export interface DesktopPnpm {
  runPlugin(
    args: readonly string[],
    invokingDir: string,
    signal?: AbortSignal,
  ): DesktopPnpmHandle
  runExternalMarketPluginInstall(
    args: readonly string[],
    invokingDir: string,
    signal?: AbortSignal,
  ): DesktopPnpmHandle
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopProfiles: DesktopProfiles
    desktopPnpm: DesktopPnpm
  }
}

/** Host → Electron start of one plugin package operation. */
export interface PluginRunIpcEvent {
  readonly type: 'plugin-run'
  readonly requestId: number
  readonly args: readonly string[]
}

/** Host → Electron cancellation of one in-flight plugin package operation. */
export interface PluginRunCancelIpcEvent {
  readonly type: 'plugin-run-cancel'
  readonly requestId: number
}

interface PendingPluginRun {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly resolve: (result: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  readonly reject: (error: Error) => void
}

let nextRequestId = 1
let transportSend: ((event: PluginRunIpcEvent | PluginRunCancelIpcEvent) => void) | undefined
const pending = new Map<number, PendingPluginRun>()

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

/**
 * Install the Host → Electron sender used by {@link createDesktopPnpm}.
 * `main` calls this before Cordis boot so Plugin Market can mutate packages after `ready`.
 * @param send - `process.send` wrapper that already handles a closed IPC channel.
 */
export function setDesktopPluginTransport(
  send: (event: PluginRunIpcEvent | PluginRunCancelIpcEvent) => void,
): void {
  transportSend = send
}

/**
 * Drop the sender and fail every in-flight package operation.
 * @param error - rejection for pending plugin-run waits.
 */
export function clearDesktopPluginTransport(error: Error): void {
  transportSend = undefined
  for (const waiter of pending.values()) {
    waiter.stdout.destroy()
    waiter.stderr.destroy()
    waiter.reject(error)
  }
  pending.clear()
}

/**
 * Append one stdout or stderr chunk from Electron.
 * @param requestId - id from the matching Host `plugin-run` event.
 * @param stream - which pipe the chunk belongs to.
 * @param chunk - UTF-8 text from bundled pnpm.
 * @returns whether a waiter existed.
 */
export function completePluginRunData(
  requestId: number,
  stream: 'stdout' | 'stderr',
  chunk: string,
): boolean {
  const waiter = pending.get(requestId)
  if (waiter === undefined) return false
  const target = stream === 'stdout' ? waiter.stdout : waiter.stderr
  target.write(chunk)
  return true
}

/**
 * Finish one Electron plugin-run acknowledgement.
 * @param requestId - id from the matching Host `plugin-run` event.
 * @param exitCode - pnpm exit code, or null when killed by a signal.
 * @param signal - terminating signal name, or null on a normal exit.
 * @returns whether a waiter existed.
 */
export function completePluginRunDone(
  requestId: number,
  exitCode: number | null,
  signal: string | null,
): boolean {
  const waiter = pending.get(requestId)
  if (waiter === undefined) return false
  pending.delete(requestId)
  waiter.stdout.end()
  waiter.stderr.end()
  waiter.resolve({
    exitCode,
    signal: signal === null ? null : signal as NodeJS.Signals,
  })
  return true
}

function runThroughIpc(
  args: readonly string[],
  signal?: AbortSignal,
): DesktopPnpmHandle {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const send = transportSend
  if (send === undefined) {
    const done = Promise.resolve({ exitCode: 127, signal: null })
    queueMicrotask(() => {
      stderr.end('dsh desktop: plugin package transport is unavailable')
      stdout.end()
    })
    return { stdout, stderr, done, cancel() {} }
  }
  const requestId = nextRequestId++
  let settled = false
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const abort = (): void => {
      if (settled) return
      send({ type: 'plugin-run-cancel', requestId })
    }
    if (signal?.aborted) {
      settled = true
      queueMicrotask(() => {
        stderr.end(errorOf(signal.reason, 'dsh desktop: plugin package operation aborted').message)
        stdout.end()
        resolve({ exitCode: 1, signal: null })
      })
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(requestId, {
      stdout,
      stderr,
      resolve: (result) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        resolve(result)
      },
      reject: (error) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        stderr.end(error.message)
        stdout.end()
        reject(error)
      },
    })
    try {
      send({ type: 'plugin-run', requestId, args })
    } catch (error) {
      pending.delete(requestId)
      settled = true
      signal?.removeEventListener('abort', abort)
      reject(errorOf(error, 'dsh desktop: plugin package transport failed'))
    }
  })
  return {
    stdout,
    stderr,
    done,
    cancel() {
      if (settled) return
      send({ type: 'plugin-run-cancel', requestId })
    },
  }
}

/**
 * Publish the Desktop profile locator and Host-alive pnpm adapter.
 * @param ctx - Host context before Loader entries mount.
 * @param projectDir - Electron-owned plugin profile directory.
 */
export function provideDesktopPluginServices(ctx: Context, projectDir: string): void {
  ctx.provide('desktopProfiles', { current: { name: 'desktop', dir: projectDir } })
  ctx.provide('desktopPnpm', {
    runPlugin: (args, _invokingDir, signal) => runThroughIpc(args, signal),
    runExternalMarketPluginInstall: (args, _invokingDir, signal) => runThroughIpc(args, signal),
  } satisfies DesktopPnpm)
}
