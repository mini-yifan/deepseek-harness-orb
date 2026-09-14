import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

it('creates a Computer Use session on dsh_orb and sends from the overlay', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  let running = false
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      rpcId: string
      method: string
      payload: { args: Record<string, unknown> }
    }
    calls.push({ method: body.method, payload: body.payload.args })
    let value: unknown = {}
    if (body.method === 'workspace/create') {
      value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/modelCatalog') {
      value = {
        groups: [{ id: 'deepseek', models: [{ id: 'deepseek-v4-flash-vision-exp' }] }],
      }
    }
    if (body.method === 'session/page') {
      value = {
        records: [
          {
            type: 'event',
            event: {
              type: 'user/message',
              data: { content: [{ type: 'text', text: 'Open WeChat' }] },
            },
          },
          {
            type: 'event',
            event: {
              type: 'user/message',
              data: {
                content: [{ type: 'text', text: 'Current desktop screens.' }],
                source: { kind: 'plugin', form: 'notice' },
              },
            },
          },
        ],
      }
    }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running, projections: { asOfSeq: 0 } }] }
    }
    if (body.method === 'session/prompt') {
      running = true
      value = { accepted: true }
    }
    if (body.method === 'session/cancel') {
      running = false
      value = { accepted: true }
    }
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
  const setExpanded = vi.fn(async (expanded: boolean) => ({
    expanded,
    horizontal: 'left',
    vertical: 'up',
  }))
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
      clamp: vi.fn(),
      setExpanded,
      orbWorkspacePath: async () => '/tmp/dsh_orb',
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    expect(calls.find(call => call.method === 'workspace/create')?.payload).toEqual({
      request: { path: '/tmp/dsh_orb' },
    })
    expect(calls.find(call => call.method === 'session/create')?.payload).toEqual({
      request: { agentPreset: 'computer-use', workspaceId: 'ws-orb' },
    })
    expect(calls.find(call => call.method === 'session/selectModel')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        model: 'deepseek-v4-flash-vision-exp',
      },
    })
    await expect.poll(() => document.querySelector('.bubble.user')?.textContent).toBe('Open WeChat')
    expect([...document.querySelectorAll('.bubble')].map(node => node.textContent)).toEqual(['Open WeChat'])
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(true)
    document.body.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
    await expect.poll(() => setExpanded.mock.calls.some(call => call[0] === true)).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(true)
    const prompt = document.querySelector<HTMLInputElement>('#prompt')
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
    await expect.poll(() => document.body.classList.contains('running')).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#stop')?.click()
    await expect.poll(() => calls.some(call => call.method === 'session/cancel')).toBe(true)
    document.querySelector<HTMLButtonElement>('#new-conversation')?.click()
    await expect.poll(() => calls.filter(call => call.method === 'session/create').length).toBeGreaterThan(1)
    document.querySelector<HTMLButtonElement>('#ball')?.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }))
    await expect.poll(() => document.body.classList.contains('pinned')).toBe(true)
  } finally { dom.window.close() }
})
