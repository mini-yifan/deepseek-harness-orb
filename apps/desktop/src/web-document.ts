/** Local Web document and authenticated HTTP forwarding for the application window. */
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
}
const BOOT = '<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>'
const OVERLAY_READY = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>'

/** One Host index-injection row. Matches the web server's injection table. */
type IndexInjection =
  | { kind: 'global'; name: string; value: unknown }
  | { kind: 'script'; placement: 'head' | 'body'; text: string }
  | { kind: 'script-src'; placement: 'head' | 'body'; src: string }
  | { kind: 'script-preload'; src: string }
  | { kind: 'style'; text: string }
  | { kind: 'html'; placement: 'head' | 'body'; html: string }

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Render Host boot rows into index.html and resolve the boot gate in the body. */
function renderOverlayInjections(html: string, rows: readonly IndexInjection[]): string {
  let head = ''
  let body = ''
  for (const row of rows) {
    switch (row.kind) {
      case 'global': {
        const name = JSON.stringify(row.name).replaceAll('<', '\\u003c')
        const value = row.value === undefined ? 'undefined' : JSON.stringify(row.value).replaceAll('<', '\\u003c')
        head += `<script>globalThis[${name}] = ${value}</script>`
        break
      }
      case 'script':
        if (row.placement === 'head') head += `<script>${row.text}</script>`
        else body += `<script>${row.text}</script>`
        break
      case 'script-src': {
        const tag = `<script src="${escapeHtmlAttribute(row.src)}"></script>`
        if (row.placement === 'head') head += tag
        else body += tag
        break
      }
      case 'script-preload':
        head += `<link rel="preload" as="script" href="${escapeHtmlAttribute(row.src)}">`
        break
      case 'style':
        head += `<style>${row.text}</style>`
        break
      case 'html':
        if (row.placement === 'head') head += row.html
        else body += row.html
        break
      default: {
        const unexpected: never = row
        throw new Error(`desktop overlay: unknown index injection ${JSON.stringify(unexpected)}`)
      }
    }
  }
  body += OVERLAY_READY
  let out = html
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${head}${out}` : `${out.slice(0, open.index + open[0].length)}${head}${out.slice(open.index + open[0].length)}`
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${out}${body}` : `${out.slice(0, open.index + open[0].length)}${body}${out.slice(open.index + open[0].length)}`
  }
  return out
}

/**
 * Read an application-owned static asset; the index waits for asynchronous Host injections.
 * @param request - Local application request.
 * @param root - Packaged Web dist directory.
 * @returns Static response, or a missing/invalid path response.
 */
export async function serveWebDocument(request: Request, root: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const url = new URL(request.url)
  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const directory = resolve(root)
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let body: Buffer
  try { body = await readFile(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  const content = pathname === '/' || pathname === '/index.html'
    ? body.toString().replace('<head>', '<head>' + BOOT) : new Uint8Array(body)
  return new Response(request.method === 'HEAD' ? null : content, {
    headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
  })
}

/**
 * Serve the overlay transcript document with Host injections already in the HTML.
 * That iframe does not run the main-window preload, so it cannot resolve the
 * boot gate itself. The rendered tail resolves the gate after the rows.
 * @param request - Overlay `index.html` request.
 * @param root - Packaged Web dist directory.
 * @param injections - Host boot rows for this launch.
 * @param streamBaseUrl - HTTP origin of the owned Host. The page origin is `dsh-app`, so the event stream cannot use `document.baseURI`.
 * @returns The rendered document, or a missing-file response.
 */
export async function serveOverlayDocument(
  request: Request, root: string, injections: readonly unknown[], streamBaseUrl: string,
): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const target = resolve(root, 'index.html')
  let html: string
  try { html = await readFile(target, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  const transport = `<script>globalThis.__DSH_TRANSPORT__=${JSON.stringify({ ownsHost: true, streamBaseUrl })}</script>`
  const rendered = renderOverlayInjections(html.replace('<head>', `<head>${transport}`), injections as readonly IndexInjection[])
  return new Response(request.method === 'HEAD' ? null : rendered, {
    headers: { 'content-type': MIME['.html'] ?? 'text/html; charset=utf-8' },
  })
}

/**
 * Exchange the Host launch URL for an authority-bound browser cookie.
 * @param url - Authenticated URL reported by the owned Host process.
 * @returns Cookie header for requests forwarded to that Host.
 */
export async function authenticateWebHost(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')
  await response.body?.cancel()
  if (response.status !== 303 || cookie === null) throw new Error('Desktop Host authentication failed')
  const end = cookie.indexOf(';')
  return end < 0 ? cookie : cookie.slice(0, end)
}

/**
 * Response headers not relayed to the renderer. `set-cookie` would hand the
 * Host's authentication cookie to the page's cookie jar, which the shell owns
 * instead; the rest describe the Node `fetch` connection (its encoding, length,
 * and hop-by-hop transport), which Chromium never sees.
 */
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  'content-encoding', 'content-length',
  'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
]

/** Host routes whose responses carry immutable cache headers keyed by a per-process revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u

/**
 * Forward local application requests to its authenticated Host, preserving streaming and cancellation.
 * Plugin bundle responses lose their `cache-control` for `no-store`: the Host marks them immutable
 * under a revision that changes every launch, so Chromium's disk cache would only accumulate bundles
 * no later launch can reuse.
 * @param request - Request from the application window or the floating-ball shell.
 * @param host - Owned Host URL.
 * @param cookie - Host-issued authentication cookie.
 * @returns Host response without connection-level headers.
 */
export async function forwardWebRequest(request: Request, host: string, cookie: string): Promise<Response> {
  const source = new URL(request.url)
  const origin = request.headers.get('origin')
  // The floating-ball shell calls the Host from dsh-app://shell. Every other page origin stays refused.
  if (origin !== null && origin !== 'dsh-app://app' && origin !== 'dsh-app://shell') {
    return new Response(null, { status: 403 })
  }
  const target = new URL(host)
  target.pathname = source.pathname
  target.search = source.search
  const headers = new Headers(request.headers)
  for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name)
  headers.set('cookie', cookie)
  const init = { method: request.method, headers, body: request.body, signal: request.signal, duplex: 'half', redirect: 'manual' as const }
  const response = await fetch(target, init)
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set('cache-control', 'no-store')
  return new Response(response.body, { status: response.status, headers: outgoing })
}
