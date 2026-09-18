/**
 * Fetch-to-node:http synthesis for in-process `WebServer.dispatch`.
 * Named route handlers keep IncomingMessage/ServerResponse ownership; the
 * carrier never listens.
 * @module @deepseek-ai/dsh-host-webserver/src/dispatch
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Named exact or prefix route used by in-process Fetch dispatch. */
export interface DispatchRoute {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

const encoder = new TextEncoder()

function headerRecord(headers: Headers, url: URL): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [name, value] of headers.entries()) record[name.toLowerCase()] = value
  if (record.host === undefined && url.host !== '') record.host = url.host
  return record
}

function requestUrl(url: URL): string {
  return `${url.pathname}${url.search}`
}

function outgoingHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (value === undefined || value === null) return headers
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const name = entry[0]
      const headerValue = entry[1]
      if (typeof name === 'string' && headerValue !== undefined) headers[name.toLowerCase()] = String(headerValue)
    }
    return headers
  }
  if (typeof value !== 'object') return headers
  for (const [name, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (headerValue === undefined) continue
    headers[name.toLowerCase()] = Array.isArray(headerValue)
      ? headerValue.map(item => String(item)).join(', ')
      : String(headerValue)
  }
  return headers
}

/**
 * Run one named route against a Fetch request and return its streaming Response.
 * @param request - the carrier-reconstructed Fetch request, including Host and Origin.
 * @param route - the exact or longest-prefix named route.
 * @returns the handler's response once `end` or `destroy` settles.
 */
export async function dispatchNamedRoute(request: Request, route: DispatchRoute): Promise<Response> {
  const url = new URL(request.url)
  const headers = headerRecord(request.headers, url)
  let requestAborted = false
  const listeners = new Map<string, Set<() => void>>()
  const emit = (event: string): void => {
    for (const callback of [...(listeners.get(event) ?? [])]) callback()
  }

  const req = {
    url: requestUrl(url),
    method: request.method,
    headers,
    destroy: (): void => { requestAborted = true },
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      if (request.body === null) return
      for await (const chunk of request.body) {
        if (requestAborted) return
        if (chunk.byteLength > 0) yield chunk
      }
    },
  } as IncomingMessage

  let status = 200
  let responseHeaders: Record<string, string> = {}
  let headersSent = false
  let finished = false
  const body = new TransformStream<Uint8Array, Uint8Array>()
  const writer = body.writable.getWriter()

  const sendHead = (): void => {
    if (headersSent) return
    headersSent = true
  }

  const res = {
    writeHead: (nextStatus: number, statusMessageOrHeaders?: unknown, maybeHeaders?: unknown): ServerResponse => {
      status = nextStatus
      const rawHeaders = typeof statusMessageOrHeaders === 'string' ? maybeHeaders : statusMessageOrHeaders
      if (rawHeaders !== undefined) {
        responseHeaders = { ...responseHeaders, ...outgoingHeaders(rawHeaders) }
      }
      return res as ServerResponse
    },
    setHeader: (name: string, value: string | number | readonly string[]): ServerResponse => {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.map(item => String(item)).join(', ') : String(value)
      return res as ServerResponse
    },
    getHeader: (name: string): string | undefined => responseHeaders[name.toLowerCase()],
    write: (chunk: string | Uint8Array, encodingOrCallback?: unknown, maybeCallback?: unknown): boolean => {
      const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback
        : typeof maybeCallback === 'function' ? maybeCallback : undefined
      if (finished) {
        if (typeof callback === 'function') callback()
        return false
      }
      sendHead()
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
      void writer.write(bytes).then(() => {
        if (typeof callback === 'function') callback()
      /* v8 ignore next 3 -- TransformStream write rejects only after abort/close */
      }, () => {
        if (typeof callback === 'function') callback()
      })
      return true
    },
    end: (chunk?: string | Uint8Array, encodingOrCallback?: unknown, maybeCallback?: unknown): ServerResponse => {
      const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback
        : typeof maybeCallback === 'function' ? maybeCallback : undefined
      if (finished) {
        if (typeof callback === 'function') callback()
        return res as ServerResponse
      }
      finished = true
      if (chunk !== undefined && typeof chunk !== 'function') {
        sendHead()
        const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
        void writer.write(bytes).then(async () => {
          await writer.close()
          emit('close')
          if (typeof callback === 'function') callback()
        /* v8 ignore next 4 -- TransformStream write rejects only after abort/close */
        }, () => {
          emit('close')
          if (typeof callback === 'function') callback()
        })
        return res as ServerResponse
      }
      sendHead()
      void writer.close().then(() => {
        emit('close')
        if (typeof callback === 'function') (typeof chunk === 'function' ? chunk : callback)()
      /* v8 ignore next 4 -- TransformStream close rejects only after abort/close */
      }, () => {
        emit('close')
        if (typeof callback === 'function') (typeof chunk === 'function' ? chunk : callback)()
      })
      return res as ServerResponse
    },
    destroy: (): void => {
      if (finished) return
      finished = true
      void writer.close().catch(() => {
        // end() already closed the writer.
      })
      emit('close')
    },
    on: (event: string, callback: () => void): ServerResponse => {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
      return res as ServerResponse
    },
    off: (event: string, callback: () => void): ServerResponse => {
      listeners.get(event)?.delete(callback)
      return res as ServerResponse
    },
    once: (event: string, callback: () => void): ServerResponse => {
      const wrapped = (): void => {
        listeners.get(event)?.delete(wrapped)
        callback()
      }
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(wrapped)
      listeners.set(event, set)
      return res as ServerResponse
    },
  }
  Object.defineProperty(res, 'headersSent', { get: () => headersSent })
  Object.defineProperty(res, 'writableEnded', { get: () => finished })
  Object.defineProperty(res, 'statusCode', {
    get: () => status,
    set: (value: number) => { status = value },
  })

  const abort = (): void => {
    requestAborted = true
    if (finished) return
    finished = true
    void writer.close().catch(() => {
      // end() already closed the writer.
    })
    emit('close')
  }
  request.signal.addEventListener('abort', abort, { once: true })

  try {
    await route.handler(req, res as ServerResponse)
    if (!finished) res.end()
  } catch (error) {
    abort()
    throw error
  } finally {
    request.signal.removeEventListener('abort', abort)
  }

  return new Response(body.readable, {
    status,
    headers: new Headers(Object.entries(responseHeaders)),
  })
}
