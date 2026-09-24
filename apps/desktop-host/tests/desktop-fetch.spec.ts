import { describe, expect, it } from 'vitest'
import { desktopCarrierHeaders, routeDesktopFetch } from '../src/desktop-fetch.ts'

function handler(status: number, body: string): { fetch(request: Request): Promise<Response> } {
  return { fetch: async () => new Response(body, { status }) }
}

function handlers(overrides: {
  webServer?: { dispatch?(request: Request): Promise<Response | undefined> }
  clientModules?: { fetchBundle(request: Request): Response | Promise<Response> }
} = {}) {
  return {
    streams: handler(200, 'stream'),
    api: handler(200, 'api'),
    clientModules: overrides.clientModules ?? { fetchBundle: async () => new Response('plugins', { status: 200 }) },
    webServer: overrides.webServer,
    assets: handler(200, 'spa'),
  }
}

describe('desktop Host fetch order', () => {
  it('sends named webServer routes after API and plugin bundles and before SPA assets', async () => {
    const webServer = {
      async dispatch(request: Request): Promise<Response | undefined> {
        const pathname = new URL(request.url).pathname
        if (!pathname.startsWith('/dsh-market')) return undefined
        const origin = request.headers.get('origin')
        const host = request.headers.get('host')
        expect(origin).toBe('dsh-app://app')
        expect(host).toBe('app')
        expect(new URL(origin ?? '').host).toBe(host)
        return new Response(request.method, { status: 201 })
      },
    }
    const posted = await routeDesktopFetch(new Request('dsh-app://app/dsh-market/install', {
      method: 'POST',
      headers: { host: 'app', origin: 'dsh-app://app' },
    }), handlers({ webServer }))
    expect(posted.status).toBe(201)
    expect(await posted.text()).toBe('POST')
    expect(await (await routeDesktopFetch(
      new Request('dsh-app://app/api/session'),
      handlers({ webServer }),
    )).text()).toBe('api')
    expect(await (await routeDesktopFetch(
      new Request('dsh-app://app/plugins/ui.js'),
      handlers({ webServer }),
    )).text()).toBe('plugins')
    expect(await (await routeDesktopFetch(
      new Request('dsh-app://app/index.html'),
      handlers({ webServer }),
    )).text()).toBe('spa')
    expect(await (await routeDesktopFetch(
      new Request('dsh-app://app/.dsh/remote-stream', { method: 'POST' }),
      handlers({ webServer }),
    )).text()).toBe('stream')
  })

  it('falls through to SPA assets when webServer has no dispatch', async () => {
    const response = await routeDesktopFetch(
      new Request('dsh-app://app/index.html'),
      handlers({ webServer: {} }),
    )
    expect(await response.text()).toBe('spa')
  })

  it('fills Host and Origin from the dsh-app URL when Chromium omitted them', () => {
    const url = new URL('dsh-app://app/dsh-market/install')
    const headers = desktopCarrierHeaders(url, new Headers())
    expect(headers.get('host')).toBe('app')
    expect(headers.get('origin')).toBe('dsh-app://app')
    expect(new URL(headers.get('origin') ?? '').host).toBe(headers.get('host'))
    const preserved = desktopCarrierHeaders(url, new Headers({ host: 'kept', origin: 'https://kept.example' }))
    expect(preserved.get('host')).toBe('kept')
    expect(preserved.get('origin')).toBe('https://kept.example')
  })
})
