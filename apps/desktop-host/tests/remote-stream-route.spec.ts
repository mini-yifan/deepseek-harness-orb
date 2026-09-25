import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-gateway'
import { DESKTOP_REMOTE_STREAM_PATH, serveDesktopRemoteStream } from '../src/remote-stream-route.ts'

const ready = { type: 'ready', clientId: 'client-1', host: { name: 'desktop' } }

function host(frames: readonly unknown[]) {
  const ctx = new Context()
  const opened: { endpoint: string; payload: unknown }[] = []
  const gateway = {
    wireStream: {
      open: async (endpoint: string, payload: unknown) => {
        opened.push({ endpoint, payload })
        return (async function* () {
          for (const frame of frames) yield frame
        })()
      },
    },
  }
  return { ctx, gateway, opened }
}

describe('desktop remote stream route', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  })

  it('writes one $events ready frame as NDJSON', async () => {
    const { ctx, gateway, opened } = host([ready])
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, listen: false })
    ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_REMOTE_STREAM_PATH,
      handler: (req, res) => serveDesktopRemoteStream(gateway, req, res),
    })
    const response = await ctx.webServer.dispatch(new Request(`http://127.0.0.1${DESKTOP_REMOTE_STREAM_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: '$events', payload: { args: {} } }),
    }))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('application/x-ndjson')
    expect(await response?.text()).toBe(`${JSON.stringify(ready)}\n`)
    expect(opened).toEqual([{ endpoint: '$events', payload: { args: {} } }])
  })

  it('rejects a non-POST stream request', async () => {
    const { ctx, gateway } = host([])
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, listen: false })
    ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_REMOTE_STREAM_PATH,
      handler: (req, res) => serveDesktopRemoteStream(gateway, req, res),
    })
    const response = await ctx.webServer.dispatch(new Request(`http://127.0.0.1${DESKTOP_REMOTE_STREAM_PATH}`))
    expect(response?.status).toBe(405)
    expect(await response?.text()).toBe('')
  })
})
