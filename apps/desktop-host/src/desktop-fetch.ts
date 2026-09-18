/**
 * Desktop Host Fetch dispatch order for the `dsh-app://` carrier.
 * Named webServer routes run after Host API and plugin bundles and before SPA assets.
 * @module @deepseek-ai/dsh-desktop-host/desktop-fetch
 */

const DESKTOP_STREAM_PATH = '/.dsh/remote-stream'

/** Fetch handlers owned by one running Desktop Host. */
export interface DesktopFetchHandlers {
  readonly streams: { fetch(request: Request): Promise<Response> }
  readonly api: { fetch(request: Request): Promise<Response> }
  readonly clientModules: { fetchBundle(request: Request): Response | Promise<Response> }
  readonly webServer: { dispatch?(request: Request): Promise<Response | undefined> } | undefined
  readonly assets: { fetch(request: Request): Promise<Response> }
}

/**
 * Fill Host and Origin when Chromium omitted them on the custom-scheme Request.
 * Market `sameOrigin` compares `new URL(origin).host` with `Host`.
 * @param url - reconstructed `dsh-app://` URL.
 * @param headers - headers forwarded from Electron.
 * @returns headers that include Host and Origin when the URL supplies them.
 */
export function desktopCarrierHeaders(url: URL, headers: Headers): Headers {
  const next = new Headers(headers)
  if (!next.has('host') && url.host !== '') next.set('host', url.host)
  if (!next.has('origin')) {
    const origin = url.origin === 'null' && url.host !== ''
      ? `${url.protocol}//${url.host}`
      : url.origin
    if (origin !== 'null' && origin !== '') next.set('origin', origin)
  }
  return next
}

/**
 * Route one reconstructed Fetch request through Desktop Host handlers.
 * @param request - `dsh-app://` request, including Host and Origin.
 * @param handlers - stream, API, plugin-bundle, named-route, and SPA handlers.
 * @returns the first matching handler's Response.
 */
export async function routeDesktopFetch(
  request: Request,
  handlers: DesktopFetchHandlers,
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (pathname === DESKTOP_STREAM_PATH) return handlers.streams.fetch(request)
  if (pathname.startsWith('/api/')) return handlers.api.fetch(request)
  if (pathname.startsWith('/plugins/')) return handlers.clientModules.fetchBundle(request)
  const server = handlers.webServer
  if (server !== undefined && typeof server.dispatch === 'function') {
    const named = await server.dispatch(request)
    if (named !== undefined) return named
  }
  return handlers.assets.fetch(request)
}

export { DESKTOP_STREAM_PATH }
