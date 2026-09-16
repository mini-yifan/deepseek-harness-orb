import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

function isRemoteStream(input: string | URL): boolean {
  return String(input).includes('/.dsh/remote-stream')
}

function hangingStreamResponse(signal: AbortSignal | null | undefined): {
  ok: true
  body: { getReader(): { read(): Promise<never>; cancel(): void } }
} {
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((_resolve, reject) => {
              if (signal?.aborted) {
                reject(signal.reason)
                return
              }
              signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
            })
          },
          cancel() {},
        }
      },
    },
  }
}

function createNdjsonPump() {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let wake: (() => void) | undefined
  let aborted: unknown
  const attach = (signal: AbortSignal | null | undefined): void => {
    if (signal == null) return
    const onAbort = (): void => {
      aborted = signal.reason
      wake?.()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    push(frame: unknown) {
      chunks.push(encoder.encode(`${JSON.stringify(frame)}\n`))
      wake?.()
    },
    response(signal: AbortSignal | null | undefined) {
      attach(signal)
      return {
        ok: true as const,
        body: {
          getReader: () => ({
            async read() {
              while (chunks.length === 0) {
                if (aborted !== undefined) throw aborted
                await new Promise<void>((resolve) => { wake = resolve })
                if (aborted !== undefined) throw aborted
              }
              return { done: false as const, value: chunks.shift() }
            },
            cancel() {},
          }),
        },
      }
    },
  }
}

function rpcResponse(rpcId: string, value: unknown) {
  return {
    ok: true,
    json: async () => ({
      type: 'server-response',
      rpcId,
      result: { ok: true, value },
    }),
  }
}

it('creates a Computer Use session on dsh_orb and sends from the overlay', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  let running = false
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
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
        groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }],
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
      setSessionRunning: vi.fn(),
      onSelectionPrompt: () => () => {},
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
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      },
    })
    await expect.poll(() => document.querySelector('.bubble.user')?.textContent).toBe('Open WeChat')
    expect(document.querySelector('#new-conversation')?.textContent).toBe('+')
    expect(document.querySelector('#new-conversation')?.getAttribute('aria-label')).toBe('New')
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
    expect(document.querySelector('#panel')?.contains(document.querySelector('#stop'))).toBe(false)
    expect(document.querySelector('#stop')?.parentElement).toBe(document.body)
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#stop')?.click()
    await expect.poll(() => calls.some(call => call.method === 'session/cancel')).toBe(true)
    document.querySelector<HTMLButtonElement>('#new-conversation')?.click()
    await expect.poll(() => calls.filter(call => call.method === 'session/create').length).toBeGreaterThan(1)
    document.querySelector<HTMLButtonElement>('#ball')?.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }))
    await expect.poll(() => document.body.classList.contains('pinned')).toBe(true)
    document.querySelector<HTMLButtonElement>('#ball')?.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }))
    await expect.poll(() => document.body.classList.contains('pinned')).toBe(false)
    expect(document.body.classList.contains('expanded')).toBe(true)
    expect(document.body.classList.contains('expand-left')).toBe(true)
    expect(document.body.classList.contains('expand-up')).toBe(true)
    expect(setExpanded.mock.calls.some(call => call[0] === false)).toBe(false)
  } finally { dom.window.close() }
})

it('collapses then moves by the ball grab offset instead of the window origin', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  let releaseCollapse: (() => void) | undefined
  const collapseGate = new Promise<void>((resolve) => {
    releaseCollapse = resolve
  })
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string }
    let value: unknown = {}
    if (body.method === 'workspace/create') value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/modelCatalog') value = { groups: [] }
    if (body.method === 'session/page') value = { records: [] }
    if (body.method === 'session/list') value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
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
  const setExpanded = vi.fn(async (expanded: boolean) => {
    if (!expanded) await collapseGate
    return { expanded, horizontal: 'left', vertical: 'up' }
  })
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
      setSessionRunning: vi.fn(),
      onSelectionPrompt: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  const dispatchPointer = (target: EventTarget, type: string, init: Record<string, unknown>) => {
    const event = new dom.window.Event(type, { bubbles: true })
    Object.assign(event, init)
    target.dispatchEvent(event)
  }
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const ball = document.querySelector('#ball')
    if (ball === null) throw new Error('missing ball')
    Object.defineProperty(ball, 'setPointerCapture', { value: vi.fn() })
    Object.defineProperty(ball, 'getBoundingClientRect', {
      value: () => ({
        x: 248,
        y: 348,
        left: 248,
        top: 348,
        width: 72,
        height: 72,
        right: 320,
        bottom: 420,
        toJSON() {},
      }),
    })
    dispatchPointer(ball, 'pointerdown', { pointerId: 1, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    dispatchPointer(ball, 'pointermove', { pointerId: 1, clientX: 268, clientY: 348, screenX: 1000, screenY: 780 })
    await expect.poll(() => setExpanded.mock.calls.some(call => call[0] === false)).toBe(true)
    expect(api.floating.move).not.toHaveBeenCalled()
    releaseCollapse?.()
    await expect.poll(() => api.floating.move.mock.calls).toEqual([[980, 760]])
    dispatchPointer(ball, 'pointerup', { pointerId: 1, clientX: 268, clientY: 328, screenX: 1000, screenY: 760 })
    await expect.poll(() => api.floating.clamp.mock.calls.length).toBe(1)
    expect(document.body.classList.contains('pinned')).toBe(false)
  } finally {
    releaseCollapse?.()
    dom.window.close()
  }
})

it('does not snap the ball to the window origin when the panel collapses', () => {
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(css).not.toContain('body:not(.expanded) #ball')
})

it('places Stop at the opposite pill end from the ball', () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  const ball = html.indexOf('id="ball"')
  const stop = html.indexOf('id="stop"')
  expect(ball).toBeGreaterThan(-1)
  expect(stop).toBeGreaterThan(ball)
  expect(html).not.toMatch(/id="panel"[\s\S]*id="stop"[\s\S]*<\/section>/u)
  expect(css).toMatch(/#ball \{[^}]*z-index: 1/u)
  expect(css).toMatch(/#stop \{[^}]*z-index: 2/u)
  expect(css).toMatch(/body\.expand-left #stop \{\s*left: 14px/u)
  expect(css).toMatch(/body\.expand-right #stop \{\s*right: 14px/u)
  expect(css).not.toMatch(/body\.expand-left #stop \{\s*right:/u)
  expect(css).not.toMatch(/body\.expand-right #stop \{\s*left:/u)
})

it('places History at the top-left opposite New', () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(html.indexOf('id="history"')).toBeGreaterThan(-1)
  expect(html.indexOf('id="history"')).toBeLessThan(html.indexOf('id="new-conversation"'))
  expect(html).toContain('id="new-conversation" type="button">+</button>')
  expect(html).toContain('id="history-list"')
  expect(css).toMatch(/#history \{\s*left: 12px/u)
  expect(css).toMatch(/#new-conversation \{\s*right: 12px/u)
})

it('lists orb Computer Use chats and reopens the selected session', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  const pages: Record<string, string> = {
    'session-orb': 'Open WeChat',
    'session-old': 'Click Pages',
  }
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
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
    if (body.method === 'session/create') {
      const request = body.payload.args.request as { sessionId?: string }
      value = {
        sessionId: request.sessionId ?? 'session-orb',
        agentPreset: 'computer-use',
      }
    }
    if (body.method === 'session/modelCatalog') {
      value = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }
    }
    if (body.method === 'session/page') {
      const request = body.payload.args.request as { address: { sessionId: string } }
      value = {
        records: [{
          type: 'event',
          event: {
            type: 'user/message',
            data: { content: [{ type: 'text', text: pages[request.address.sessionId] ?? 'unknown' }] },
          },
        }],
      }
    }
    if (body.method === 'session/list') {
      value = {
        items: [
          {
            sessionId: 'session-orb',
            cwd: '/tmp/dsh_orb',
            running: false,
            projections: { asOfSeq: 0, values: { agentPreset: 'computer-use', title: 'Open WeChat' } },
          },
          {
            sessionId: 'session-old',
            cwd: '/tmp/dsh_orb',
            running: false,
            projections: { asOfSeq: 2, values: { agentPreset: 'computer-use', title: 'Click Pages' } },
          },
          {
            sessionId: 'session-blank',
            cwd: '/tmp/dsh_orb',
            blank: true,
            running: false,
            projections: { asOfSeq: -1, values: { agentPreset: 'computer-use' } },
          },
          {
            sessionId: 'session-code',
            cwd: '/tmp/dsh_orb',
            running: false,
            projections: { asOfSeq: 1, values: { agentPreset: 'standard', title: 'Write Word' } },
          },
          {
            sessionId: 'session-other',
            cwd: '/other',
            running: false,
            projections: { asOfSeq: 1, values: { agentPreset: 'computer-use', title: 'Other workspace' } },
          },
          {
            sessionId: 'session-sub',
            cwd: '/tmp/dsh_orb',
            origin: 'subagent',
            running: false,
            projections: { asOfSeq: 1, values: { agentPreset: 'computer-use', title: 'Child' } },
          },
        ],
      }
    }
    if (body.method === 'session/prompt') value = { accepted: true }
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
      setExpanded: async (expanded: boolean) => ({ expanded, horizontal: 'left', vertical: 'up' }),
      orbWorkspacePath: async () => '/tmp/dsh_orb',
      setSessionRunning: vi.fn(),
      onSelectionPrompt: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => document.querySelector('.bubble.user')?.textContent).toBe('Open WeChat')
    const history = document.querySelector<HTMLButtonElement>('#history')
    const transcript = document.querySelector<HTMLElement>('#transcript')
    const historyList = document.querySelector<HTMLElement>('#history-list')
    if (history === null || transcript === null || historyList === null) throw new Error('missing overlay history chrome')
    expect(historyList.hidden).toBe(true)
    history.click()
    await expect.poll(() => historyList.hidden).toBe(false)
    expect(transcript.hidden).toBe(true)
    expect(history.getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => [...document.querySelectorAll('.history-row')].map(node => node.textContent)).toEqual([
      'Open WeChat',
      'Click Pages',
      'Untitled conversation',
    ])
    history.click()
    await expect.poll(() => historyList.hidden).toBe(true)
    expect(transcript.hidden).toBe(false)
    expect(document.querySelector('.bubble.user')?.textContent).toBe('Open WeChat')
    history.click()
    await expect.poll(() => [...document.querySelectorAll('.history-row')].some(node => node.textContent === 'Click Pages')).toBe(true)
    const prior = [...document.querySelectorAll('.history-row')].find(node => node.textContent === 'Click Pages')
    if (prior === undefined) throw new Error('missing prior Computer Use row')
    prior.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await expect.poll(() => historyList.hidden).toBe(true)
    await expect.poll(() => document.querySelector('.bubble.user')?.textContent).toBe('Click Pages')
    expect(setSessionId.mock.calls.at(-1)).toEqual(['session-old'])
    expect(calls.some((call) => {
      if (call.method !== 'session/create') return false
      const request = (call.payload as { request?: { sessionId?: string } }).request
      return request?.sessionId === 'session-old'
    })).toBe(true)
    const prompt = document.querySelector<HTMLInputElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    prompt.value = 'Scroll down'
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(calls.findLast(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-old',
        mode: 'queue',
        content: [{ type: 'text', text: 'Scroll down' }],
      },
    })
  } finally { dom.window.close() }
})

async function mountQuestionOverlay() {
  const pump = createNdjsonPump()
  const calls: { method: string; payload: unknown }[] = []
  const pages: Record<string, string> = {
    'session-orb': 'Open WeChat',
    'session-old': 'Click Pages',
  }
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return pump.response(init?.signal)
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
    if (body.method === 'session/create') {
      const request = body.payload.args.request as { sessionId?: string }
      value = {
        sessionId: request.sessionId ?? 'session-orb',
        agentPreset: 'computer-use',
      }
    }
    if (body.method === 'session/modelCatalog') {
      value = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }
    }
    if (body.method === 'session/page') {
      const request = body.payload.args.request as { address: { sessionId: string } }
      value = {
        records: [{
          type: 'event',
          event: {
            type: 'user/message',
            data: { content: [{ type: 'text', text: pages[request.address.sessionId] ?? 'unknown' }] },
          },
        }],
      }
    }
    if (body.method === 'session/list') {
      value = {
        items: [
          {
            sessionId: 'session-orb',
            cwd: '/tmp/dsh_orb',
            running: true,
            projections: { asOfSeq: 0, values: { agentPreset: 'computer-use', title: 'Open WeChat' } },
          },
          {
            sessionId: 'session-old',
            cwd: '/tmp/dsh_orb',
            running: false,
            projections: { asOfSeq: 2, values: { agentPreset: 'computer-use', title: 'Click Pages' } },
          },
        ],
      }
    }
    if (body.method === 'session/prompt' || body.method === '$events/result') value = {}
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  const setExpanded = vi.fn(async (expanded: boolean) => ({
    expanded,
    horizontal: 'left',
    vertical: 'up',
  }))
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
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
        setSessionRunning: vi.fn(),
        onSelectionPrompt: () => () => {},
      },
    },
  })
  runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
  pump.push({ type: 'ready', clientId: 'client-orb', host: { home: '/tmp' } })
  return { dom, calls, pump, setExpanded }
}

function resultCalls(calls: { method: string; payload: unknown }[]) {
  return calls.filter(call => call.method === '$events/result')
}

it('shows a Computer Use question on the overlay and submits a selected option', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-choice',
      agentId: 'session-orb',
      request: {
        questions: [{
          id: 'q1',
          question: 'Which app should I open?',
          header: 'Desktop',
          options: [
            { label: 'WeChat (recommended)', description: 'Messages' },
            { label: 'Pages' },
          ],
        }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('Which app should I open?')
    expect(document.querySelector<HTMLElement>('#question')?.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#transcript')?.hidden).toBe(true)
    expect(document.body.classList.contains('asking')).toBe(true)
    expect(document.querySelector('#question-eyebrow')?.textContent).toBe('Desktop')
    expect(document.querySelector('.question-recommended')?.textContent).toBe('Recommended')
    expect(overlay.setExpanded.mock.calls.some(call => call[0] === true)).toBe(true)
    const wechat = [...document.querySelectorAll('.question-option')]
      .find(node => node.textContent?.includes('WeChat'))
    if (wechat === undefined) throw new Error('missing WeChat option')
    wechat.dispatchEvent(new overlay.dom.window.Event('click', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#question-continue')?.click()
    await expect.poll(() => resultCalls(overlay.calls).length).toBe(1)
    expect(resultCalls(overlay.calls)[0]?.payload).toEqual({
      clientId: 'client-orb',
      eventId: 'ev-choice',
      outcome: {
        kind: 'result',
        value: {
          answers: [{ id: 'q1', selected: ['WeChat (recommended)'] }],
        },
      },
    })
    await expect.poll(() => document.querySelector<HTMLElement>('#question')?.hidden).toBe(true)
    expect(document.body.classList.contains('asking')).toBe(false)
  } finally { overlay.dom.window.close() }
})

it('submits custom text, skip, and cancel through $events/result', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-custom',
      agentId: 'session-orb',
      request: {
        questions: [{ id: 'q-custom', question: 'What should I type?' }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('What should I type?')
    const custom = document.querySelector<HTMLTextAreaElement>('#question-custom')
    if (custom === null) throw new Error('missing custom field')
    custom.value = 'Open Notes'
    custom.dispatchEvent(new overlay.dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#question-continue')?.click()
    await expect.poll(() => resultCalls(overlay.calls).length).toBe(1)
    expect(resultCalls(overlay.calls)[0]?.payload).toEqual({
      clientId: 'client-orb',
      eventId: 'ev-custom',
      outcome: {
        kind: 'result',
        value: { answers: [{ id: 'q-custom', selected: [], custom: 'Open Notes' }] },
      },
    })
  } finally { overlay.dom.window.close() }
})

it('skips a question with an empty selected list', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-skip',
      agentId: 'session-orb',
      request: {
        questions: [{
          id: 'q-skip',
          question: 'Skip me?',
          options: [{ label: 'Yes' }],
        }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('Skip me?')
    document.querySelector<HTMLButtonElement>('#question-skip')?.click()
    await expect.poll(() => resultCalls(overlay.calls).length).toBe(1)
    expect(resultCalls(overlay.calls)[0]?.payload).toEqual({
      clientId: 'client-orb',
      eventId: 'ev-skip',
      outcome: {
        kind: 'result',
        value: { answers: [{ id: 'q-skip', selected: [] }] },
      },
    })
  } finally { overlay.dom.window.close() }
})

it('cancels a question as ASK_CANCELLED', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-cancel',
      agentId: 'session-orb',
      request: {
        questions: [{ id: 'q-cancel', question: 'Dismiss me?' }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('Dismiss me?')
    document.querySelector<HTMLButtonElement>('#question-cancel')?.click()
    await expect.poll(() => resultCalls(overlay.calls).length).toBe(1)
    expect(resultCalls(overlay.calls)[0]?.payload).toEqual({
      clientId: 'client-orb',
      eventId: 'ev-cancel',
      outcome: {
        kind: 'rejected',
        error: {
          name: 'UserQuestionError',
          message: 'the user cancelled ask_user_question',
          code: 'ASK_CANCELLED',
        },
      },
    })
  } finally { overlay.dom.window.close() }
})

it('delegates questions from other agents with next()', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-other',
      agentId: 'session-main',
      request: {
        questions: [{ id: 'q-other', question: 'Main window only' }],
      },
    })
    await expect.poll(() => resultCalls(overlay.calls).length).toBe(1)
    expect(resultCalls(overlay.calls)[0]?.payload).toEqual({
      clientId: 'client-orb',
      eventId: 'ev-other',
      outcome: { kind: 'next' },
    })
    expect(overlay.dom.window.document.querySelector<HTMLElement>('#question')?.hidden).toBe(true)
  } finally { overlay.dom.window.close() }
})

it('dismisses the card when the Host cancels the waterfall', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-host-cancel',
      agentId: 'session-orb',
      request: {
        questions: [{ id: 'q-host', question: 'Waiting elsewhere?' }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('Waiting elsewhere?')
    overlay.pump.push({ type: 'cancel', eventId: 'ev-host-cancel' })
    await expect.poll(() => document.querySelector<HTMLElement>('#question')?.hidden).toBe(true)
    expect(resultCalls(overlay.calls)).toEqual([])
  } finally { overlay.dom.window.close() }
})

it('keeps an unanswered question while History switches away and back', async () => {
  const overlay = await mountQuestionOverlay()
  try {
    const document = overlay.dom.window.document
    overlay.pump.push({
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'ev-hold',
      agentId: 'session-orb',
      request: {
        questions: [{
          id: 'q-hold',
          question: 'Stay with this chat?',
          options: [{ label: 'Keep going' }],
        }],
      },
    })
    await expect.poll(() => document.querySelector('#question-title')?.textContent).toBe('Stay with this chat?')
    document.querySelector<HTMLButtonElement>('#history')?.click()
    await expect.poll(() => [...document.querySelectorAll('.history-row')].map(node => node.textContent)).toEqual([
      'Open WeChat',
      'Click Pages',
    ])
    expect(document.querySelector<HTMLElement>('#question')?.hidden).toBe(true)
    const prior = [...document.querySelectorAll('.history-row')].find(node => node.textContent === 'Click Pages')
    if (prior === undefined) throw new Error('missing prior Computer Use row')
    prior.dispatchEvent(new overlay.dom.window.Event('click', { bubbles: true }))
    await expect.poll(() => document.querySelector('.bubble.user')?.textContent).toBe('Click Pages')
    expect(document.querySelector<HTMLElement>('#question')?.hidden).toBe(true)
    expect(resultCalls(overlay.calls)).toEqual([])
    document.querySelector<HTMLButtonElement>('#history')?.click()
    await expect.poll(() => [...document.querySelectorAll('.history-row')].some(node => node.textContent === 'Open WeChat')).toBe(true)
    const original = [...document.querySelectorAll('.history-row')].find(node => node.textContent === 'Open WeChat')
    if (original === undefined) throw new Error('missing original Computer Use row')
    original.dispatchEvent(new overlay.dom.window.Event('click', { bubbles: true }))
    await expect.poll(() => document.querySelector<HTMLElement>('#question')?.hidden).toBe(false)
    expect(document.querySelector('#question-title')?.textContent).toBe('Stay with this chat?')
    expect(resultCalls(overlay.calls)).toEqual([])
  } finally { overlay.dom.window.close() }
})

it('expands and session/prompts a Desktop selection-toolbar message', async () => {
  const preamble = 'Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.'
  const promptText = `${preamble}\n\nExplain this text:\n\nhello`
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
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
      value = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }
    }
    if (body.method === 'session/page') value = { records: [] }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    if (body.method === 'session/prompt') value = { accepted: true }
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
  const setSessionRunning = vi.fn()
  let selectionPrompt: ((payload: { text: string }) => void) | undefined
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
      setSessionRunning,
      onSelectionPrompt(listener: (payload: { text: string }) => void) {
        selectionPrompt = listener
        return () => {}
      },
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    if (selectionPrompt === undefined) throw new Error('missing selection prompt listener')
    selectionPrompt({ text: promptText })
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(calls.find(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        mode: 'queue',
        content: [{ type: 'text', text: promptText }],
      },
    })
    expect(setExpanded.mock.calls.some(call => call[0] === true)).toBe(true)
    expect(setSessionRunning).toHaveBeenCalledWith(true)
  } finally { dom.window.close() }
})
