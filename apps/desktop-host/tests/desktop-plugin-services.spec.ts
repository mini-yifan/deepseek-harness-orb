import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  clearDesktopPluginTransport,
  completePluginRunData,
  completePluginRunDone,
  provideDesktopPluginServices,
  setDesktopPluginTransport,
  type PluginRunCancelIpcEvent,
  type PluginRunIpcEvent,
} from '../src/desktop-plugin-services.ts'

async function readText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of Readable.from(stream)) {
    chunks.push(Buffer.from(chunk as Buffer | string))
  }
  return Buffer.concat(chunks).toString('utf8')
}

afterEach(() => {
  clearDesktopPluginTransport(new Error('test teardown'))
})

describe('desktop plugin package IPC', () => {
  it('exits 127 when the Electron transport is unavailable', async () => {
    const ctx = new Context()
    provideDesktopPluginServices(ctx, '/tmp/desktop-profile')
    expect(ctx.desktopProfiles.current).toEqual({ name: 'desktop', dir: '/tmp/desktop-profile' })
    const handle = ctx.desktopPnpm.runPlugin(['add', 'dshmarket@1.47.0'], '/tmp')
    await expect(handle.done).resolves.toEqual({ exitCode: 127, signal: null })
    expect(await readText(handle.stderr)).toMatch(/plugin package transport is unavailable/u)
  })

  it('forwards stdout and completes Host-alive install through Electron', async () => {
    const sent: Array<PluginRunIpcEvent | PluginRunCancelIpcEvent> = []
    setDesktopPluginTransport((event) => { sent.push(event) })
    const ctx = new Context()
    provideDesktopPluginServices(ctx, '/tmp/desktop-profile')
    const handle = ctx.desktopPnpm.runExternalMarketPluginInstall(['add', 'plugin@1.0.0'], '/tmp')
    expect(sent).toEqual([{ type: 'plugin-run', requestId: expect.any(Number), args: ['add', 'plugin@1.0.0'] }])
    const requestId = (sent[0] as PluginRunIpcEvent).requestId
    expect(completePluginRunData(requestId, 'stdout', 'progress\n')).toBe(true)
    expect(completePluginRunData(requestId, 'stderr', 'warn\n')).toBe(true)
    expect(completePluginRunDone(requestId, 0, null)).toBe(true)
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(await readText(handle.stdout)).toBe('progress\n')
    expect(await readText(handle.stderr)).toBe('warn\n')
  })

  it('cancels an in-flight run and ignores unknown completions', async () => {
    const sent: Array<PluginRunIpcEvent | PluginRunCancelIpcEvent> = []
    setDesktopPluginTransport((event) => { sent.push(event) })
    const ctx = new Context()
    provideDesktopPluginServices(ctx, '/tmp/desktop-profile')
    const abort = new AbortController()
    abort.abort(new Error('already aborted'))
    const aborted = ctx.desktopPnpm.runPlugin(['add', 'plugin@1.0.0'], '/tmp', abort.signal)
    aborted.cancel()
    await expect(aborted.done).resolves.toEqual({ exitCode: 1, signal: null })
    expect(sent).toEqual([])
    expect(completePluginRunData(999, 'stdout', 'x')).toBe(false)
    expect(completePluginRunDone(999, 1, null)).toBe(false)

    const live = ctx.desktopPnpm.runPlugin(['remove', 'plugin'], '/tmp')
    const requestId = (sent[0] as PluginRunIpcEvent).requestId
    live.cancel()
    expect(sent.at(-1)).toEqual({ type: 'plugin-run-cancel', requestId })
    expect(completePluginRunDone(requestId, 1, 'SIGTERM')).toBe(true)
    await expect(live.done).resolves.toEqual({ exitCode: 1, signal: 'SIGTERM' })
  })
})
