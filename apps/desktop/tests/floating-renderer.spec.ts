import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { FloatingDockState } from '../src/floating-window.ts'
import { composeSelectionSendPrompt } from '../src/selection-prompt.ts'

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

const OVERLAY_CHAT_SRC = 'dsh-app://app/index.html?surface=overlay'

function recordIframePosts(iframe: HTMLIFrameElement): { data: unknown; origin: unknown }[] {
  const posts: { data: unknown; origin: unknown }[] = []
  const win = iframe.contentWindow
  if (win === null) return posts
  const orig = win.postMessage.bind(win)
  win.postMessage = (data: unknown, origin?: unknown) => {
    posts.push({ data, origin })
    try {
      orig(data, origin as string)
    } catch {
      // JSDOM iframe documents have no loaded origin.
    }
  }
  return posts
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

function setPromptText(prompt: HTMLElement, text: string) {
  prompt.textContent = text
  prompt.classList.toggle('prompt-empty', text.trim() === '')
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
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt: () => () => {},
      onSelectionAttach: () => () => {},
      onCreateSession: () => () => {},
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
        saveAsDefault: false,
      },
    })
    expect(calls.some(call => call.method === 'session/page')).toBe(false)
    expect(document.querySelector('#new-conversation')?.textContent).toBe('+')
    expect(document.querySelector('#new-conversation')?.getAttribute('aria-label')).toBe('New')
    expect(document.querySelector('.bubble.assistant')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(true)
    document.body.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
    await expect.poll(() => document.querySelector('#transcript iframe')?.getAttribute('src')).toBe(OVERLAY_CHAT_SRC)
    expect(document.querySelector('.bubble.assistant')).toBeNull()
    expect(document.querySelector('.bubble.user')).toBeNull()
    const frame = document.querySelector<HTMLIFrameElement>('#transcript iframe')
    if (frame === null) throw new Error('missing overlay chat iframe')
    expect(frame.getAttribute('allow')).toBe('clipboard-write')
    const posts = recordIframePosts(frame)
    const win = document.defaultView
    if (win === null) throw new Error('missing overlay window')
    win.dispatchEvent(new win.MessageEvent('message', {
      origin: 'dsh-app://app',
      data: { type: 'dsh.overlay.ready' },
    }))
    expect(posts.some(post =>
      (post.data as { type?: string; sessionId?: string }).type === 'dsh.overlay.session'
      && (post.data as { sessionId?: string }).sessionId === 'session-orb'
      && post.origin === 'dsh-app://app')).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('#stop')?.hidden).toBe(true)
    expect(document.querySelector('#permission-label')?.textContent).toBe('Full access')
    document.querySelector<HTMLButtonElement>('#permission-button')?.click()
    await expect.poll(() => document.querySelector<HTMLElement>('#permission-menu')?.hidden).toBe(false)
    const workspaceWrite = [...document.querySelectorAll<HTMLButtonElement>('#permission-menu button')]
      .find(node => node.textContent === 'Workspace Write')
    workspaceWrite?.click()
    await expect.poll(() => (api.floating.setOverlayPermission as ReturnType<typeof vi.fn>).mock.calls)
      .toEqual([['workspace-write', 'session-orb']])
    expect(calls.some(call => call.method === 'commands/execute')).toBe(false)
    expect(document.querySelector('#permission-label')?.textContent).toBe('Workspace Write')
    const prompt = document.querySelector<HTMLElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    setPromptText(prompt, 'Write a Word document')
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect((api.floating.setOverlayPermission as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['workspace-write', 'session-orb'],
      ['workspace-write', 'session-orb'],
    ])
    expect(calls.some(call => call.method === 'commands/execute')).toBe(false)
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
    const ball = document.querySelector<HTMLButtonElement>('#ball')
    if (ball === null) throw new Error('missing ball')
    const pin = () => {
      const event = new dom.window.Event('pointerup', { bubbles: true })
      Object.assign(event, { button: 0 })
      ball.dispatchEvent(event)
    }
    pin()
    await expect.poll(() => document.body.classList.contains('pinned')).toBe(true)
    pin()
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
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt: () => () => {},
      onSelectionAttach: () => () => {},
      onCreateSession: () => () => {},
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
    dispatchPointer(ball, 'pointerdown', { pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    dispatchPointer(ball, 'pointermove', { pointerId: 1, buttons: 1, clientX: 268, clientY: 348, screenX: 1000, screenY: 780 })
    await expect.poll(() => setExpanded.mock.calls.some(call => call[0] === false)).toBe(true)
    expect(api.floating.move).not.toHaveBeenCalled()
    releaseCollapse?.()
    await expect.poll(() => api.floating.move.mock.calls).toEqual([[980, 760, true]])
    dispatchPointer(ball, 'pointerup', { pointerId: 1, button: 0, clientX: 268, clientY: 328, screenX: 1000, screenY: 760 })
    await expect.poll(() => api.floating.clamp.mock.calls.length).toBe(1)
    expect(document.body.classList.contains('pinned')).toBe(false)
  } finally {
    releaseCollapse?.()
    dom.window.close()
  }
})

async function mountPointerOverlay(options?: { dark?: boolean; running?: boolean }) {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  if (options?.dark === true) {
    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-color-scheme: dark'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }),
    })
  }
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string }
    let value: unknown = {}
    if (body.method === 'workspace/create') value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/modelCatalog') value = { groups: [] }
    if (body.method === 'session/page') value = { records: [] }
    if (body.method === 'session/list') {
      value = {
        items: [{
          sessionId: 'session-orb',
          running: options?.running === true,
          projections: { asOfSeq: 0 },
        }],
      }
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
  const setExpanded = vi.fn(async (expanded: boolean) => ({
    expanded, horizontal: 'left', vertical: 'up', docked: undefined,
  }))
  const api = {
    locale: async () => resolveDesktopLocale('en'),
    backend: {
      status: async () => ({ phase: 'ready' }),
      subscribe: vi.fn(),
    },
    floating: {
      sessionId: async () => undefined,
      setSessionId: vi.fn(),
      move: vi.fn(async (_x: number, _y: number, _canDock?: boolean): Promise<FloatingDockState> => (
        { docked: undefined }
      )),
      clamp: vi.fn(async (_canDock?: boolean): Promise<FloatingDockState> => ({ docked: undefined })),
      unsnap: vi.fn(async (): Promise<FloatingDockState> => ({ docked: undefined })),
      setExpanded,
      orbWorkspacePath: async () => '/tmp/dsh_orb',
      setSessionRunning: vi.fn(),
      setTextEditing: vi.fn(),
      restoreFrontApp: vi.fn(),
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt: () => () => {},
      onSelectionAttach: () => () => {},
      onCreateSession: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  const document = dom.window.document
  await expect.poll(() => api.floating.setSessionId.mock.calls).toEqual([['session-orb']])
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
  const dispatchPointer = (type: string, init: Record<string, unknown>) => {
    const event = new dom.window.Event(type, { bubbles: true })
    Object.assign(event, init)
    ball.dispatchEvent(event)
  }
  return { dom, document, api, dispatchPointer }
}

it('restores the front app on a running overlay click outside a text field', async () => {
  const overlay = await mountPointerOverlay({ running: true })
  try {
    await expect.poll(() => overlay.document.body.classList.contains('running')).toBe(true)
    const history = overlay.document.querySelector('#history')
    if (history === null) throw new Error('missing history button')
    const pointerup = (target: EventTarget) => {
      const event = new overlay.dom.window.Event('pointerup', { bubbles: true })
      Object.assign(event, { button: 0 })
      target.dispatchEvent(event)
    }
    pointerup(history)
    expect(overlay.api.floating.restoreFrontApp).toHaveBeenCalledTimes(1)
    const prompt = overlay.document.querySelector('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    prompt.focus()
    expect(overlay.api.floating.setTextEditing).toHaveBeenCalledWith(true)
    pointerup(prompt)
    expect(overlay.api.floating.restoreFrontApp).toHaveBeenCalledTimes(1)
  } finally { overlay.dom.window.close() }
})

it('ignores a secondary-button press so later hover cannot move the ball', async () => {
  const overlay = await mountPointerOverlay()
  try {
    overlay.dispatchPointer('pointerdown', { pointerId: 1, button: 2, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    overlay.dispatchPointer('pointermove', { pointerId: 1, buttons: 0, clientX: 268, clientY: 300, screenX: 1000, screenY: 700 })
    overlay.dispatchPointer('pointerup', { pointerId: 1, button: 2, clientX: 268, clientY: 300, screenX: 1000, screenY: 700 })
    expect(overlay.api.floating.move).not.toHaveBeenCalled()
    expect(overlay.api.floating.clamp).not.toHaveBeenCalled()
    expect(overlay.document.body.classList.contains('pinned')).toBe(false)
  } finally {
    overlay.dom.window.close()
  }
})

it('ends a primary grab when the button is no longer down', async () => {
  const overlay = await mountPointerOverlay()
  try {
    overlay.dispatchPointer('pointerdown', { pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    overlay.dispatchPointer('pointermove', { pointerId: 1, buttons: 0, clientX: 268, clientY: 300, screenX: 1000, screenY: 700 })
    expect(overlay.api.floating.move).not.toHaveBeenCalled()
    overlay.dispatchPointer('pointerdown', { pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    overlay.dispatchPointer('lostpointercapture', { pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800 })
    overlay.dispatchPointer('pointermove', { pointerId: 1, buttons: 0, clientX: 268, clientY: 300, screenX: 1000, screenY: 700 })
    expect(overlay.api.floating.move).not.toHaveBeenCalled()
  } finally {
    overlay.dom.window.close()
  }
})

async function dragUntilMove(overlay: Awaited<ReturnType<typeof mountPointerOverlay>>) {
  overlay.dispatchPointer('pointerdown', {
    pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800,
  })
  overlay.dispatchPointer('pointermove', {
    pointerId: 1, buttons: 1, clientX: 268, clientY: 300, screenX: 1400, screenY: 700,
  })
  overlay.dispatchPointer('pointerup', {
    pointerId: 1, button: 0, clientX: 268, clientY: 300, screenX: 1400, screenY: 700,
  })
}

it('docks from clamp, ignores hover for 800ms, then unsnaps', async () => {
  const overlay = await mountPointerOverlay()
  const nativeSetTimeout = overlay.dom.window.setTimeout.bind(overlay.dom.window)
  let hoverDelay: (() => void) | undefined
  overlay.dom.window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms === 800 && typeof fn === 'function') {
      hoverDelay = () => { fn() }
      return 0
    }
    return nativeSetTimeout(fn, ms, ...args)
  }) as typeof overlay.dom.window.setTimeout
  try {
    overlay.api.floating.move.mockResolvedValue({ docked: undefined })
    overlay.api.floating.clamp.mockResolvedValue({ docked: 'right' })
    overlay.api.floating.unsnap.mockResolvedValue({ docked: undefined })
    dragUntilMove(overlay)
    await expect.poll(() => overlay.document.body.classList.contains('docked')).toBe(true)
    expect(overlay.document.body.classList.contains('docked-right')).toBe(true)
    expect(overlay.document.querySelector<HTMLButtonElement>('#dock-tab')?.hidden).toBe(false)
    overlay.document.body.dispatchEvent(new overlay.dom.window.Event('pointerenter', { bubbles: true }))
    expect(overlay.api.floating.unsnap).not.toHaveBeenCalled()
    hoverDelay?.()
    await expect.poll(() => overlay.api.floating.unsnap.mock.calls.length).toBe(1)
    expect(overlay.document.body.classList.contains('docked')).toBe(false)
  } finally {
    overlay.dom.window.close()
  }
})

it('does not force-collapse or allow dock while the Computer Use session is running', async () => {
  const overlay = await mountPointerOverlay({ running: true })
  try {
    await expect.poll(() => overlay.document.body.classList.contains('running')).toBe(true)
    overlay.api.floating.setExpanded.mockClear()
    overlay.dispatchPointer('pointerdown', {
      pointerId: 1, button: 0, clientX: 268, clientY: 368, screenX: 1000, screenY: 800,
    })
    overlay.dispatchPointer('pointermove', {
      pointerId: 1, buttons: 1, clientX: 268, clientY: 300, screenX: 1400, screenY: 700,
    })
    await expect.poll(() => overlay.api.floating.move.mock.calls.length).toBeGreaterThan(0)
    expect(overlay.api.floating.setExpanded.mock.calls.some(call => call[0] === false)).toBe(false)
    expect(overlay.api.floating.move.mock.calls[0]?.[2]).toBe(false)
  } finally {
    overlay.dom.window.close()
  }
})

it('does not snap the ball to the window origin when the panel collapses', () => {
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(css).not.toContain('body:not(.expanded) #ball')
})

it('overrides chrome tokens under html[data-ds-dark-theme] and paints the iframe with --white', () => {
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(css).toMatch(/html\[data-ds-dark-theme\] \{[^}]*--white: rgb\(21, 21, 23\)/u)
  expect(css).toMatch(/html\[data-ds-dark-theme\] \{[^}]*--input-bg: rgb\(35, 35, 36\)/u)
  expect(css).toMatch(/#transcript iframe \{[^}]*background: var\(--white\)/u)
  expect(css).toMatch(/#question-error \{[^}]*color: var\(--error\)/u)
  expect(css).not.toMatch(/#transcript iframe \{[^}]*background: #ffffff/u)
})

it('guesses dark chrome from prefers-color-scheme then follows the overlay Host scheme', async () => {
  const overlay = await mountPointerOverlay({ dark: true })
  try {
    const root = overlay.document.documentElement
    expect(root.getAttribute('data-ds-dark-theme')).toBe('')
    expect(root.style.colorScheme).toBe('dark')
    overlay.dom.window.dispatchEvent(new overlay.dom.window.MessageEvent('message', {
      origin: 'https://example.test',
      data: { type: 'dsh.overlay.theme', colorScheme: 'light' },
    }))
    expect(root.getAttribute('data-ds-dark-theme')).toBe('')
    overlay.dom.window.dispatchEvent(new overlay.dom.window.MessageEvent('message', {
      origin: 'dsh-app://app',
      data: { type: 'dsh.overlay.theme', colorScheme: 'bogus' },
    }))
    expect(root.getAttribute('data-ds-dark-theme')).toBe('')
    overlay.dom.window.dispatchEvent(new overlay.dom.window.MessageEvent('message', {
      origin: 'dsh-app://app',
      data: { type: 'dsh.overlay.theme', colorScheme: 'light' },
    }))
    expect(root.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
    overlay.dom.window.dispatchEvent(new overlay.dom.window.MessageEvent('message', {
      origin: 'dsh-app://app',
      data: { type: 'dsh.overlay.theme', colorScheme: 'dark' },
    }))
    expect(root.getAttribute('data-ds-dark-theme')).toBe('')
    expect(root.style.colorScheme).toBe('dark')
  } finally {
    overlay.dom.window.close()
  }
})

it('paints collapsed ball shadow, expanded hairline, and outer pin stroke', () => {
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(css).toMatch(/--chrome: 12px/u)
  expect(css).toMatch(/#panel \{[^}]*inset: var\(--chrome\)/u)
  expect(css).toMatch(/body\.expanded #panel \{[^}]*border: 1px solid var\(--border\)/u)
  expect(css).toMatch(/body\.expanded #panel \{[^}]*box-shadow: var\(--panel-shadow\)/u)
  expect(css).toMatch(/#ball \{[^}]*box-shadow: var\(--ball-shadow\)/u)
  expect(css).toMatch(/body\.expanded #ball \{[^}]*box-shadow: 0 0 0 1px var\(--border\)/u)
  expect(css).toMatch(/body\.pinned #panel \{[^}]*box-shadow: 0 0 0 3px var\(--pin\)/u)
  expect(css).toMatch(/body\.pinned #ball \{[^}]*box-shadow: 0 0 0 3px var\(--pin\)/u)
  expect(css).not.toContain('inset 0 0 0 3px')
  expect(css).not.toMatch(/#ball \{[^}]*overflow:\s*hidden/u)
})

it('places the selection chip on the transcript side of the input pill', () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(html).toContain('id="selection-chip"')
  expect(html).toContain('id="selection-chip-text"')
  expect(html).toContain('id="selection-chip-dismiss"')
  expect(css).toMatch(/body\.expand-up #selection-chip \{\s*bottom: var\(--composer-height\)/u)
  expect(css).toMatch(/body\.expand-down #selection-chip \{\s*top: var\(--composer-height\)/u)
  expect(css).toMatch(/#selection-chip-text \{[^}]*text-overflow: ellipsis/u)
  expect(css).toMatch(/#selection-chip-text \{[^}]*white-space: nowrap/u)
})

it('forbids selecting overlay chrome except the composer and question fields', () => {
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(css).toMatch(/html,\s*body \{[^}]*user-select: none/u)
  expect(css).toMatch(/#prompt \{[^}]*user-select: text/u)
  expect(css).toMatch(/#question-custom \{[^}]*user-select: text/u)
})

it('grows the overlay composer around the ball with a height cap', () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(html).toMatch(/id="prompt"[^>]*contenteditable="true"/u)
  expect(html).toMatch(/id="prompt"[^>]*aria-multiline="true"/u)
  expect(css).toMatch(/--composer-max: calc\(var\(--ball\) \+ var\(--prompt-line\) \* 3\)/u)
  expect(css).toMatch(/#panel::after \{[^}]*height: var\(--composer-height\)/u)
  expect(css).toMatch(/#composer \{[^}]*height: var\(--composer-height\)/u)
  expect(css).toMatch(/--prompt-pad: 12px/u)
  expect(css).toMatch(/#prompt \{[^}]*padding: var\(--prompt-pad\) 8px/u)
  expect(css).toMatch(/#prompt::before \{[^}]*height: var\(--composer-height\)/u)
  expect(css).toMatch(/#prompt::before \{[^}]*margin-top: calc\(0px - var\(--prompt-pad\)\)/u)
  expect(css).toMatch(/body\.expand-left #prompt::before \{\s*float: right/u)
  expect(css).toMatch(/body\.expand-right #prompt::before \{\s*float: left/u)
  expect(css).toMatch(/body\.expand-up #prompt::before \{\s*shape-outside: circle\(36px at 50% calc\(100% - 36px\)\)/u)
  expect(css).toMatch(/body\.expand-down #prompt::before \{\s*shape-outside: circle\(36px at 50% 36px\)/u)
  expect(css).toMatch(/body\.composer-capped\.expand-left #prompt \{\s*padding-right: var\(--ball\)/u)
  expect(css).toMatch(/#prompt \{[^}]*white-space: pre-wrap/u)
})

async function mountComposerOverlay() {
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
    if (body.method === 'workspace/create') value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/modelCatalog') value = { groups: [] }
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
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
  const prompt = dom.window.document.querySelector<HTMLElement>('#prompt')
  if (prompt === null) throw new Error('missing prompt')
  return { dom, prompt, calls }
}

it('sends the overlay composer on Enter and keeps Shift+Enter and composing Enter local', async () => {
  const overlay = await mountComposerOverlay()
  try {
    setPromptText(overlay.prompt, 'Open Pages')
    overlay.prompt.dispatchEvent(new overlay.dom.window.KeyboardEvent('keydown', {
      key: 'Enter', shiftKey: true, bubbles: true, cancelable: true,
    }))
    overlay.prompt.dispatchEvent(new overlay.dom.window.KeyboardEvent('keydown', {
      key: 'Enter', isComposing: true, bubbles: true, cancelable: true,
    }))
    const imeEnter = new overlay.dom.window.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    })
    Object.defineProperty(imeEnter, 'keyCode', { value: 229 })
    overlay.prompt.dispatchEvent(imeEnter)
    expect(overlay.calls.some(call => call.method === 'session/prompt')).toBe(false)
    overlay.prompt.dispatchEvent(new overlay.dom.window.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }))
    await expect.poll(() => overlay.calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(overlay.calls.find(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        mode: 'queue',
        content: [{ type: 'text', text: 'Open Pages' }],
      },
    })
    expect(overlay.prompt.textContent).toBe('')
  } finally {
    overlay.dom.window.close()
  }
})

it('pastes plain text into the overlay composer and drops HTML', async () => {
  const overlay = await mountComposerOverlay()
  try {
    const event = new overlay.dom.window.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/plain' ? 'plain draft' : '<b>html</b>',
      },
    })
    overlay.prompt.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(overlay.prompt.textContent).toBe('plain draft')
    expect(overlay.prompt.innerHTML).not.toContain('<b>')
  } finally {
    overlay.dom.window.close()
  }
})

it('keeps a short overlay draft on the 72px pill and grows one line at a time', async () => {
  const js = readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8')
  expect(js).not.toMatch(/setProperty\('--composer-height', `\$\{COMPOSER_MAX_PX\}px`\)/u)
  expect(js).toMatch(/height \+ COMPOSER_LINE_PX/u)
  const overlay = await mountComposerOverlay()
  try {
    setPromptText(overlay.prompt, '你给我')
    overlay.prompt.dispatchEvent(new overlay.dom.window.Event('input', { bubbles: true }))
    expect(overlay.dom.window.document.body.style.getPropertyValue('--composer-height')).toBe('72px')
    expect(overlay.dom.window.document.body.classList.contains('composer-capped')).toBe(false)
  } finally {
    overlay.dom.window.close()
  }
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
  expect(css).toMatch(/body\.expand-left #stop \{\s*left: calc\(var\(--chrome\) \+ 14px\)/u)
  expect(css).toMatch(/body\.expand-right #stop \{\s*right: calc\(var\(--chrome\) \+ 14px\)/u)
  expect(css).not.toMatch(/body\.expand-left #stop \{\s*right:/u)
  expect(css).not.toMatch(/body\.expand-right #stop \{\s*left:/u)
})

it('places History, Access, and New on the transcript edge opposite the input pill', () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
  expect(html.indexOf('id="history"')).toBeGreaterThan(-1)
  expect(html.indexOf('id="history"')).toBeLessThan(html.indexOf('id="permission"'))
  expect(html.indexOf('id="permission"')).toBeLessThan(html.indexOf('id="new-conversation"'))
  expect(html).toContain('id="new-conversation" type="button">+</button>')
  expect(html).toContain('id="history-list"')
  expect(css).toMatch(/#history \{\s*left: 12px/u)
  expect(css).toMatch(/#new-conversation \{\s*right: 12px/u)
  expect(css).toMatch(/#permission \{\s*left: 50%/u)
  expect(css).toMatch(/#history,\s*#new-conversation,\s*#permission \{[^}]*top: 12px/u)
  expect(css).toMatch(
    /body\.expand-down #history,\s*body\.expand-down #new-conversation,\s*body\.expand-down #permission \{\s*top: auto;\s*bottom: 12px/u,
  )
  expect(css).toMatch(
    /body\.expand-down #panel \{\s*padding-top: calc\(var\(--composer-height\) \+ 10px\);\s*padding-bottom: 20px/u,
  )
  expect(css).toMatch(
    /body\.expand-down #transcript,\s*body\.expand-down #history-list,\s*body\.expand-down #question \{/u,
  )
  expect(css).toMatch(/body\.expand-down #question \{\s*padding-top: 0;\s*padding-bottom: 36px/u)
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
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt: () => () => {},
      onSelectionAttach: () => () => {},
      onCreateSession: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    expect(calls.some(call => call.method === 'session/page')).toBe(false)
    document.body.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
    await expect.poll(() => document.querySelector('#transcript iframe')?.getAttribute('src')).toBe(OVERLAY_CHAT_SRC)
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
    expect(document.querySelector('#transcript iframe')?.getAttribute('src')).toBe(OVERLAY_CHAT_SRC)
    expect(document.querySelector('#transcript iframe')?.getAttribute('allow')).toBe('clipboard-write')
    expect(document.querySelector('.bubble.assistant')).toBeNull()
    history.click()
    await expect.poll(() => [...document.querySelectorAll('.history-row')].some(node => node.textContent === 'Click Pages')).toBe(true)
    const prior = [...document.querySelectorAll('.history-row')].find(node => node.textContent === 'Click Pages')
    if (prior === undefined) throw new Error('missing prior Computer Use row')
    const frame = document.querySelector<HTMLIFrameElement>('#transcript iframe')
    if (frame === null) throw new Error('missing overlay chat iframe')
    const posts = recordIframePosts(frame)
    prior.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await expect.poll(() => historyList.hidden).toBe(true)
    await expect.poll(() => setSessionId.mock.calls.at(-1)).toEqual(['session-old'])
    await expect.poll(() => posts.some(post =>
      (post.data as { sessionId?: string }).sessionId === 'session-old')).toBe(true)
    expect(setSessionId.mock.calls.at(-1)).toEqual(['session-old'])
    expect(calls.some((call) => {
      if (call.method !== 'session/create') return false
      const request = (call.payload as { request?: { sessionId?: string } }).request
      return request?.sessionId === 'session-old'
    })).toBe(true)
    expect(calls.find((call) => {
      if (call.method !== 'session/create') return false
      const request = (call.payload as { request?: { sessionId?: string } }).request
      return request?.sessionId === 'session-old'
    })?.payload).toEqual({
      request: {
        sessionId: 'session-old',
        agentPreset: 'computer-use',
        workspaceId: 'ws-orb',
      },
    })
    const prompt = document.querySelector<HTMLElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    setPromptText(prompt, 'Scroll down')
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect((api.floating.setOverlayPermission as ReturnType<typeof vi.fn>).mock.calls.at(-1))
      .toEqual(['danger-full-access', 'session-old'])
    expect(calls.some(call => call.method === 'commands/execute')).toBe(false)
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
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
  pump.push({ type: 'ready', clientId: 'client-orb', host: { home: '/tmp' } })
  return { dom, calls, pump, setExpanded, setSessionId }
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
    expect(document.querySelector<HTMLElement>('#transcript')?.hidden).toBe(false)
    expect(document.querySelector('#transcript iframe')).not.toBeNull()
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
    await expect.poll(() => overlay.setSessionId.mock.calls.at(-1)).toEqual(['session-old'])
    expect(document.querySelector('.bubble.user')).toBeNull()
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

it('expands and session/prompts a Desktop selection-toolbar translate message', async () => {
  const preamble = 'Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.'
  const promptText = `${preamble}\n\nTranslate the following into Chinese:\n\nhello`
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
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt(listener: (payload: { text: string }) => void) {
        selectionPrompt = listener
        return () => {}
      },
      onSelectionAttach: () => () => {},
      onCreateSession: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    if (selectionPrompt === undefined) throw new Error('missing selection prompt listener')
    selectionPrompt({ text: promptText })
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect((api.floating.setOverlayPermission as ReturnType<typeof vi.fn>).mock.calls)
      .toEqual([['danger-full-access', 'session-orb']])
    expect(calls.some(call => call.method === 'commands/execute')).toBe(false)
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

it('attaches selected text to the composer until the first send or dismiss', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const calls: { method: string; payload: unknown }[] = []
  let created = 0
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
      created += 1
      value = { sessionId: created === 1 ? 'session-orb' : 'session-new', agentPreset: 'computer-use' }
    }
    if (body.method === 'session/modelCatalog') {
      value = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }
    }
    if (body.method === 'session/page') value = { records: [] }
    if (body.method === 'session/list') {
      value = {
        items: [
          { sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } },
          ...(created > 1
            ? [{ sessionId: 'session-new', running: false, projections: { asOfSeq: 0 } }]
            : []),
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
  const setExpanded = vi.fn(async (expanded: boolean) => ({
    expanded,
    horizontal: 'left',
    vertical: 'up',
  }))
  const promptFocus = vi.fn()
  let selectionAttach: ((payload: { text: string }) => void) | undefined
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
      overlayModel: async () => ({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
      }),
      overlayPermission: async () => 'danger-full-access',
      setOverlayPermission: vi.fn(),
      onOverlayModel: () => () => {},
      onSelectionPrompt: () => () => {},
      onSelectionAttach(listener: (payload: { text: string }) => void) {
        selectionAttach = listener
        return () => {}
      },
      onCreateSession: () => () => {},
    },
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const prompt = document.querySelector<HTMLElement>('#prompt')
    const chip = document.querySelector<HTMLElement>('#selection-chip')
    const chipText = document.querySelector('#selection-chip-text')
    const dismiss = document.querySelector<HTMLButtonElement>('#selection-chip-dismiss')
    if (prompt === null || chip === null || chipText === null || dismiss === null) {
      throw new Error('missing composer chip')
    }
    Object.defineProperty(prompt, 'focus', { value: promptFocus })
    if (selectionAttach === undefined) throw new Error('missing selection attach listener')
    selectionAttach({ text: 'A long selected paragraph from another app' })
    await expect.poll(() => chip.hidden).toBe(false)
    expect(calls.some(call => call.method === 'session/prompt')).toBe(false)
    expect(chipText.textContent).toBe('A long selected paragraph from another app')
    expect(document.body.classList.contains('has-selection-chip')).toBe(true)
    expect(document.body.classList.contains('expand-up')).toBe(true)
    expect(promptFocus).toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('#new-conversation')?.click()
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb'], ['session-new']])
    expect(chip.hidden).toBe(false)
    setPromptText(prompt, 'Explain this')
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(calls.find(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-new',
        mode: 'queue',
        content: [{ type: 'text', text: composeSelectionSendPrompt('Explain this', 'A long selected paragraph from another app') }],
      },
    })
    expect(chip.hidden).toBe(true)
    expect(document.body.classList.contains('has-selection-chip')).toBe(false)
    setPromptText(prompt, 'Follow up')
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => calls.filter(call => call.method === 'session/prompt')).toHaveLength(2)
    expect(calls.filter(call => call.method === 'session/prompt').at(-1)?.payload).toMatchObject({
      request: {
        content: [{ type: 'text', text: 'Follow up' }],
      },
    })
    selectionAttach({ text: 'second quote' })
    await expect.poll(() => chip.hidden).toBe(false)
    expect(chipText.textContent).toBe('second quote')
    dismiss.click()
    expect(chip.hidden).toBe(true)
    expect(document.body.classList.contains('has-selection-chip')).toBe(false)
  } finally { dom.window.close() }
})

it('places an attached selection chip below the input when the panel expands down', async () => {
  const dom = new JSDOM(readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
    url: 'dsh-app://shell/floating.html',
  })
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as {
      rpcId: string
      method: string
      payload: { args: Record<string, unknown> }
    }
    let value: unknown = {}
    if (body.method === 'workspace/create') {
      value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  let selectionAttach: ((payload: { text: string }) => void) | undefined
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId: vi.fn(),
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: async (expanded: boolean) => ({ expanded, horizontal: 'left', vertical: 'down' }),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach(listener: (payload: { text: string }) => void) {
          selectionAttach = listener
          return () => {}
        },
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    await expect.poll(() => selectionAttach !== undefined).toBe(true)
    selectionAttach?.({ text: 'quote' })
    await expect.poll(() => document.body.classList.contains('expand-down')).toBe(true)
    expect(document.querySelector<HTMLElement>('#selection-chip')?.hidden).toBe(false)
    expect(document.body.classList.contains('has-selection-chip')).toBe(true)
  } finally { dom.window.close() }
})

it('applies a live overlay model change without writing the Agent default', async () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
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
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  let overlayListener: ((selection: {
    provider: string
    model: string
    reasoningEffort?: string
  }) => void) | undefined
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        onOverlayModel(listener: (selection: {
          provider: string
          model: string
          reasoningEffort?: string
        }) => void) {
          overlayListener = listener
          return () => {}
        },
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    expect(calls.find(call => call.method === 'session/selectModel')?.payload).toEqual({
      request: {
        sessionId: 'session-orb',
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        reasoningEffort: 'high',
        saveAsDefault: false,
      },
    })
    if (overlayListener === undefined) throw new Error('missing overlay model listener')
    overlayListener({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'max',
    })
    await expect.poll(() => calls.filter(call => call.method === 'session/selectModel')).toHaveLength(2)
    expect(calls.filter(call => call.method === 'session/selectModel').at(-1)?.payload).toEqual({
      request: {
        sessionId: 'session-orb',
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
        saveAsDefault: false,
      },
    })
  } finally { dom.window.close() }
})

it('creates a blank overlay session from Host New IPC without selectModel-as-encoding', async () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
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
    if (body.method === 'session/create') {
      const creates = calls.filter(call => call.method === 'session/create').length
      value = {
        sessionId: creates === 1 ? 'session-orb' : 'session-new',
        agentPreset: 'computer-use',
      }
    }
    if (body.method === 'session/modelCatalog') {
      value = { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }
    }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    if (body.method === 'session/selectModel') value = {}
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  let createListener: (() => void) | undefined
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession(listener: () => void) {
          createListener = listener
          return () => {}
        },
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    if (createListener === undefined) throw new Error('missing overlay create listener')
    await createListener()
    await expect.poll(() => setSessionId.mock.calls.at(-1)).toEqual(['session-new'])
    const creates = calls.filter(call => call.method === 'session/create')
    expect(creates.at(-1)?.payload).toEqual({
      request: { agentPreset: 'computer-use', workspaceId: 'ws-orb' },
    })
    expect(calls.filter(call => call.method === 'session/selectModel').length).toBeGreaterThanOrEqual(2)
  } finally { dom.window.close() }
})

it('sends from the overlay when Access IPC is missing', async () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
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
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    if (body.method === 'session/prompt') value = { accepted: true }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const prompt = dom.window.document.querySelector<HTMLElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    setPromptText(prompt, 'Open WeChat')
    dom.window.document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => calls.some(call => call.method === 'session/prompt')).toBe(true)
    expect(calls.find(call => call.method === 'session/prompt')?.payload).toMatchObject({
      request: {
        sessionId: 'session-orb',
        mode: 'queue',
        content: [{ type: 'text', text: 'Open WeChat' }],
      },
    })
    expect(calls.some(call => call.method === 'commands/execute')).toBe(false)
  } finally { dom.window.close() }
})

it('applies a pushed custom avatar URL to the ball image', async () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string }
    let value: unknown = {}
    if (body.method === 'workspace/create') {
      value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  let onAvatar: ((url: string) => void) | undefined
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        avatarUrl: async () => 'dsh-app://shell/orb-avatar?v=1',
        onAvatar: (listener: (url: string) => void) => {
          onAvatar = listener
          return () => { onAvatar = undefined }
        },
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const gif = dom.window.document.querySelector<HTMLImageElement>('#ball-gif')
    await expect.poll(() => gif?.src).toBe('dsh-app://shell/orb-avatar?v=1')
    onAvatar?.('dsh-app://shell/orb-avatar?v=2')
    expect(gif?.src).toBe('dsh-app://shell/orb-avatar?v=2')
  } finally { dom.window.close() }
})

it('covers the overlay with the TCC gate on first expand and blocks send', async () => {
  const status = {
    applicable: true,
    appName: 'DeepSeek Orb',
    screen: 'missing',
    accessibility: 'missing',
  }
  const tccStatus = vi.fn(async () => status)
  const openTcc = vi.fn(async (right: 'screen' | 'accessibility') => {
    if (right === 'screen') status.screen = 'needsRelaunch'
    else status.accessibility = 'needsRelaunch'
    return { ...status }
  })
  const relaunch = vi.fn(async () => undefined)
  let onTccStatus: ((status: {
    applicable: boolean
    appName: string
    screen: string
    accessibility: string
  }) => void) | undefined
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
  const calls: { method: string }[] = []
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string }
    calls.push({ method: body.method })
    let value: unknown = {}
    if (body.method === 'workspace/create') {
      value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    if (body.method === 'session/prompt') value = { accepted: true }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        overlayPermission: async () => 'danger-full-access',
        setOverlayPermission: vi.fn(),
        tccStatus,
        openTcc,
        relaunch,
        onTccStatus: (listener: (status: {
          applicable: boolean
          appName: string
          screen: string
          accessibility: string
        }) => void) => {
          onTccStatus = listener
          return () => { onTccStatus = undefined }
        },
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const document = dom.window.document
    expect(document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(true)
    document.body.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
    await expect.poll(() => document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(false)
    expect(document.querySelector('#tcc-title')?.textContent).toBe('Desktop agent needs two Mac permissions')
    expect(document.querySelector('#tcc-app')?.textContent).toBe('In the list, turn on DeepSeek Orb.')
    expect(document.body.classList.contains('tcc-gating')).toBe(true)
    const prompt = document.querySelector<HTMLElement>('#prompt')
    if (prompt === null) throw new Error('missing prompt')
    setPromptText(prompt, 'Open WeChat')
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => tccStatus.mock.calls.length).toBeGreaterThan(1)
    expect(calls.some(call => call.method === 'session/prompt')).toBe(false)
    expect(prompt.textContent).toBe('Open WeChat')
    document.querySelector<HTMLButtonElement>('#tcc-later')?.click()
    expect(document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(true)
    document.querySelector<HTMLFormElement>('#composer')?.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )
    await expect.poll(() => document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(false)
    expect(calls.some(call => call.method === 'session/prompt')).toBe(false)
    document.querySelector<HTMLButtonElement>('#tcc-screen-open')?.click()
    await expect.poll(() => document.querySelector('#tcc-screen-status')?.textContent).toBe('On — quit and reopen')
    expect(openTcc).toHaveBeenCalledWith('screen')
    expect(document.querySelector<HTMLButtonElement>('#tcc-relaunch')?.hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#tcc-relaunch')?.click()
    expect(relaunch).toHaveBeenCalledTimes(1)
    onTccStatus?.({
      applicable: true,
      appName: 'DeepSeek Orb',
      screen: 'granted',
      accessibility: 'granted',
    })
    expect(document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(true)
    expect(document.body.classList.contains('tcc-gating')).toBe(false)
  } finally { dom.window.close() }
})

it('hides the TCC gate when both rights are already granted', async () => {
  const html = readFileSync(new URL('../renderer/floating.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'dsh-app://shell/floating.html' })
  const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (isRemoteStream(_input)) return hangingStreamResponse(init?.signal)
    const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string }
    let value: unknown = {}
    if (body.method === 'workspace/create') {
      value = { workspace: { workspaceId: 'ws-orb' }, created: true }
    }
    if (body.method === 'session/create') value = { sessionId: 'session-orb', agentPreset: 'computer-use' }
    if (body.method === 'session/list') {
      value = { items: [{ sessionId: 'session-orb', running: false, projections: { asOfSeq: 0 } }] }
    }
    return rpcResponse(body.rpcId, value)
  })
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock })
  Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto })
  const setSessionId = vi.fn()
  Object.defineProperty(dom.window, 'dshDesktop', {
    value: {
      locale: async () => resolveDesktopLocale('en'),
      backend: { status: async () => ({ phase: 'ready' }), subscribe: vi.fn() },
      floating: {
        sessionId: async () => undefined,
        setSessionId,
        move: vi.fn(),
        clamp: vi.fn(),
        setExpanded: vi.fn(async (expanded: boolean) => ({
          expanded, horizontal: 'left', vertical: 'up',
        })),
        orbWorkspacePath: async () => '/tmp/dsh_orb',
        setSessionRunning: vi.fn(),
        overlayModel: async () => ({
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
        }),
        tccStatus: async () => ({
          applicable: true,
          appName: 'DeepSeek Orb',
          screen: 'granted',
          accessibility: 'granted',
        }),
        onTccStatus: () => () => {},
        onOverlayModel: () => () => {},
        onSelectionPrompt: () => () => {},
        onSelectionAttach: () => () => {},
        onCreateSession: () => () => {},
      },
    },
  })
  try {
    runInContext(readFileSync(new URL('../renderer/floating.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    await expect.poll(() => setSessionId.mock.calls).toEqual([['session-orb']])
    const document = dom.window.document
    document.body.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
    await expect.poll(() => document.body.classList.contains('expanded')).toBe(true)
    expect(document.querySelector<HTMLElement>('#tcc-gate')?.hidden).toBe(true)
    expect(document.body.classList.contains('tcc-gating')).toBe(false)
  } finally { dom.window.close() }
})
