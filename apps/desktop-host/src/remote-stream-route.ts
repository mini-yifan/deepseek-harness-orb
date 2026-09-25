/** NDJSON `$events` stream the floating-ball shell already posts to. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway'

/** Pathname the floating ball posts to open a Host stream. */
export const DESKTOP_REMOTE_STREAM_PATH = '/.dsh/remote-stream'

/** The gateway surface this route uses to open one logical stream. */
export interface DesktopRemoteStreamGateway {
  readonly wireStream: {
    open: (
      endpoint: string,
      payload: unknown,
      uplink: AsyncIterable<unknown>,
      peer: undefined,
      signal: AbortSignal,
    ) => Promise<AsyncIterable<unknown>>
  }
}

async function* emptyUplink(): AsyncGenerator<never, void, unknown> {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isStreamRequest(value: unknown): value is { endpoint: string; payload: unknown } {
  if (typeof value !== 'object' || value === null) return false
  return typeof Reflect.get(value, 'endpoint') === 'string' && Object.hasOwn(value, 'payload')
}

/**
 * Answer one floating-ball stream request with NDJSON from `typertGateway.wireStream`.
 * `$events` ignores the uplink. The request signal aborts the stream when the shell disconnects.
 * @param gateway - active Host gateway. Absent answers 503.
 * @param req - POST body `{ endpoint, payload }`.
 * @param res - NDJSON response, left open for the life of the stream.
 */
export async function serveDesktopRemoteStream(
  gateway: DesktopRemoteStreamGateway | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req))
  } catch (error: unknown) {
    // A truncated or non-JSON body is a bad request, not a stream failure.
    void error
    res.writeHead(400)
    res.end()
    return
  }
  if (!isStreamRequest(parsed)) {
    res.writeHead(400)
    res.end()
    return
  }
  if (gateway === undefined) {
    res.writeHead(503)
    res.end()
    return
  }
  const abort = new AbortController()
  const stop = (): void => { abort.abort() }
  req.on?.('aborted', stop)
  res.on('close', stop)
  try {
    const values = await gateway.wireStream.open(
      parsed.endpoint,
      parsed.payload,
      emptyUplink(),
      undefined,
      abort.signal,
    )
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-transform',
    })
    for await (const value of values) {
      if (abort.signal.aborted || res.writableEnded) break
      res.write(`${JSON.stringify(value)}\n`)
    }
    if (!res.writableEnded) res.end()
  } catch (error: unknown) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    res.writeHead(502)
    res.end()
  } finally {
    req.off?.('aborted', stop)
    res.off('close', stop)
  }
}

/**
 * Register the floating-ball stream route on the listening Host web server.
 * @param ctx - booted Desktop application context.
 * @returns the route disposer.
 */
export function registerDesktopRemoteStream(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: DESKTOP_REMOTE_STREAM_PATH,
    handler: (req, res) => serveDesktopRemoteStream(ctx.typertGateway, req, res),
  })
}
