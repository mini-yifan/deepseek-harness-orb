import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

it('creates a Computer Use session over Host RPC and hides it from the main window', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      rpcId: string
      method: string
      payload: { args: Record<string, unknown> }
    }
    calls.push({ method: body.method, payload: body.payload.args })
    let value: unknown = {}
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/modelCatalog') {
      value = {
        groups: [{ id: 'deepseek', models: [{ id: 'deepseek-v4-flash-vision-exp' }] }],
      }
    }
    if (body.method === 'session/page') {
      value = {
        records: [{
          type: 'event',
          event: {
            type: 'user/message',
            data: { content: [{ type: 'text', text: 'Open WeChat' }] },
          },
        }],
      }
    }
    if (body.method === 'session/prompt') value = { accepted: true }
    if (body.method === 'session/cancel') value = { accepted: true }
    return {
      ok: true,
      json: async () => ({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value },
      }),
    }
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  const toggle = vi.fn(async () => true)
  const api = {
    locale: async () => resolveDesktopLocale('en'),
    backend: {
      status: async () => ({ phase: 'ready' }),
      subscribe: vi.fn(),
    },
    floating: {
      sessionId: async () => undefined,
      setSessionId,
      move: vi.fn(),
      dock: vi.fn(),
      toggle,
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    expect(calls.map(call => call.method)).toContain('session/create')
    expect(calls.find(call => call.method === 'session/create')?.payload).toEqual({
      request: { agentPreset: 'computer-use' },
    })
    expect(calls.find(call => call.method === 'session/modelCatalog')?.payload).toEqual({})
    expect(calls.find(call => call.method === 'session/selectModel')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        model: 'deepseek-v4-flash-vision-exp',
      },
    })
    await expect.poll(() => document.querySelector('#transcript')?.textContent).toBe('Open WeChat')
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    prompt.value = 'Write a Word document'
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(calls.find(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        mode: 'queue',
        content: [{ type: 'text', text: 'Write a Word document' }],
      },
    })
    document.querySelector<HTMLButtonElement>('#stop')?.click()
    await expect.poll(() => calls.some(call => call.method === 'session/cancel')).toBe(true)
    document.querySelector<HTMLButtonElement>('#ball')?.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }))
    await expect.poll(() => toggle.mock.calls.length).toBeGreaterThan(0)
  } finally { dom.window.close() }
})
