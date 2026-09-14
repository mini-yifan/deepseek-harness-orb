const api = window.dshDesktop
const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_REASONING = 'max'
const GIF_SRC = 'deepseek-avatar-square.gif'
const COLLAPSE_MS = 180
const ANIMATION_MS = 300

function rpcId() {
  return crypto.randomUUID()
}

async function rpc(method, args = {}) {
  const id = rpcId()
  const response = await fetch(`dsh-app://app/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload: { args } }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const envelope = await response.json()
  if (envelope?.type !== 'server-response' || envelope.rpcId !== id) {
    throw new Error('session rpc envelope mismatch')
  }
  if (envelope.result?.ok !== true) {
    throw new Error(envelope.result?.error?.message ?? 'session rpc failed')
  }
  return envelope.result.value
}

function pickDefault(catalog) {
  for (const group of catalog.groups ?? []) {
    const exact = group.models.find(model => model.id === DEFAULT_MODEL)
    if (exact) return { provider: group.id, model: exact.id }
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL }
}

function eventText(record) {
  const event = record?.event
  if (event === undefined) return undefined
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return undefined
  const data = event.data ?? {}
  const source = data.source ?? data.message?.source
  if (source?.kind === 'plugin' || source?.form === 'notice') return undefined
  const content = data.content ?? data.message?.content ?? []
  const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (text === '') return undefined
  return { role: event.type === 'user/message' ? 'user' : 'assistant', text }
}

function orbComputerUseItems(items, orbPath) {
  return (items ?? []).filter(item =>
    item.origin !== 'subagent'
    && item.cwd === orbPath
    && item.projections?.values?.agentPreset === 'computer-use')
}

function overlayTitle(item, untitled) {
  const title = item.projections?.values?.title
  return typeof title === 'string' && title !== '' ? title : untitled
}

async function main() {
  const locale = await api.locale()
  const messages = locale.messages
  document.documentElement.lang = locale.id
  document.querySelector('#page-title').textContent = messages.floatingTitle
  document.querySelector('#prompt').placeholder = messages.floatingPlaceholder
  document.querySelector('#stop').setAttribute('aria-label', messages.floatingStop)
  document.querySelector('#stop').title = messages.floatingStop
  document.querySelector('#new-conversation').textContent = messages.floatingNewConversation
  document.querySelector('#new-conversation').setAttribute('aria-label', messages.floatingNewConversation)
  const historyButton = document.querySelector('#history')
  historyButton.setAttribute('aria-label', messages.floatingHistory)
  historyButton.title = messages.floatingHistory
  document.querySelector('#input-label').textContent = messages.floatingPlaceholder
  const ball = document.querySelector('#ball')
  const panel = document.querySelector('#panel')
  const transcript = document.querySelector('#transcript')
  const historyList = document.querySelector('#history-list')
  const status = document.querySelector('#status')
  const prompt = document.querySelector('#prompt')
  const stop = document.querySelector('#stop')
  let sessionId = await api.floating.sessionId()
  let workspaceId
  let orbWorkspacePath
  let historyOpen = false
  let dragging = false
  let collapsing = false
  let pinned = false
  let expanded = false
  let running = false
  let pointer = undefined
  let lastOrigin = undefined
  let collapseTimer = undefined
  let collapseFrame = undefined

  function freezeGif(gif) {
    const still = () => {
      if (gif.dataset.mode !== 'still' || gif.naturalWidth === 0) return
      const canvas = document.createElement('canvas')
      canvas.width = gif.naturalWidth
      canvas.height = gif.naturalHeight
      const context = canvas.getContext('2d')
      if (context === null) return
      context.drawImage(gif, 0, 0)
      try {
        gif.src = canvas.toDataURL()
      } catch {
        // JSDOM may reject toDataURL; the GIF already reset to frame 0.
      }
    }
    if (gif.complete && gif.naturalWidth > 0) still()
    else gif.addEventListener('load', still, { once: true })
  }

  function syncGif() {
    const gif = document.querySelector('#ball-gif')
    const play = expanded || running
    if (play) {
      if (gif.dataset.mode !== 'play') {
        gif.dataset.mode = 'play'
        gif.src = GIF_SRC
      }
      return
    }
    if (gif.dataset.mode === 'still') return
    gif.dataset.mode = 'still'
    gif.src = GIF_SRC
    freezeGif(gif)
  }

  function setRunning(next) {
    running = next
    document.body.classList.toggle('running', running)
    stop.hidden = !expanded || !running
    syncGif()
  }

  function applyDirection(state) {
    document.body.classList.toggle('expand-left', state.horizontal === 'left')
    document.body.classList.toggle('expand-right', state.horizontal === 'right')
    document.body.classList.toggle('expand-up', state.vertical === 'up')
    document.body.classList.toggle('expand-down', state.vertical === 'down')
  }

  async function setExpanded(next, force = false) {
    if (collapseTimer !== undefined) {
      clearTimeout(collapseTimer)
      collapseTimer = undefined
    }
    if (collapseFrame !== undefined) {
      clearTimeout(collapseFrame)
      collapseFrame = undefined
    }
    if (next) {
      const state = await api.floating.setExpanded(true)
      applyDirection(state)
      panel.hidden = false
      expanded = true
      document.body.classList.add('expanded')
      stop.hidden = !running
      syncGif()
      return
    }
    if (!force && (pinned || running)) return
    expanded = false
    document.body.classList.remove('expanded')
    stop.hidden = true
    syncGif()
    if (force) {
      panel.hidden = true
      await api.floating.setExpanded(false)
      return
    }
    collapseFrame = setTimeout(() => {
      collapseFrame = undefined
      panel.hidden = true
      void api.floating.setExpanded(false)
    }, ANIMATION_MS)
  }

  function ballGrabOffset(event) {
    const rect = ball.getBoundingClientRect()
    return { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
  }

  function scheduleCollapse() {
    if (pinned || running || dragging) return
    if (collapseTimer !== undefined) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      void setExpanded(false)
    }, COLLAPSE_MS)
  }

  async function selectDefaultModel(id) {
    try {
      const catalog = await rpc('session/modelCatalog')
      const selected = pickDefault(catalog)
      await rpc('session/selectModel', {
        request: {
          sessionId: id,
          provider: selected.provider,
          model: selected.model,
          reasoningEffort: DEFAULT_REASONING,
        },
      })
    } catch {
      // A missing catalog or unsupported route leaves the session on its deployment default.
    }
  }

  async function orbCwd() {
    if (orbWorkspacePath === undefined) orbWorkspacePath = await api.floating.orbWorkspacePath()
    return orbWorkspacePath
  }

  async function ensureWorkspace() {
    if (workspaceId !== undefined) return workspaceId
    const path = await orbCwd()
    const created = await rpc('workspace/create', { request: { path } })
    workspaceId = created.workspace.workspaceId
    return workspaceId
  }

  async function persistSession(id) {
    sessionId = id
    await api.floating.setSessionId(id)
    await selectDefaultModel(id)
    return id
  }

  async function adoptSession(id) {
    await rpc('session/create', {
      request: {
        sessionId: id,
        agentPreset: 'computer-use',
        workspaceId: await ensureWorkspace(),
      },
    })
    return persistSession(id)
  }

  async function createOrbSession() {
    const id = (await rpc('session/create', {
      request: {
        agentPreset: 'computer-use',
        workspaceId: await ensureWorkspace(),
      },
    })).sessionId
    return persistSession(id)
  }

  async function ensureSession() {
    if (sessionId !== undefined) {
      try {
        return await adoptSession(sessionId)
      } catch {
        // A persisted id that the Host no longer holds is replaced below.
        sessionId = undefined
      }
    }
    return createOrbSession()
  }

  function setHistoryOpen(next) {
    historyOpen = next
    transcript.hidden = historyOpen
    historyList.hidden = !historyOpen
    historyButton.setAttribute('aria-pressed', String(historyOpen))
  }

  function renderTranscript(records) {
    const bubbles = (records ?? []).map(eventText).filter(entry => entry !== undefined)
    transcript.replaceChildren()
    for (const bubble of bubbles) {
      const node = document.createElement('div')
      node.className = `bubble ${bubble.role}`
      node.textContent = bubble.text
      transcript.append(node)
    }
    transcript.scrollTop = transcript.scrollHeight
  }

  async function renderHistory(items) {
    const rows = orbComputerUseItems(items, await orbCwd())
    historyList.replaceChildren()
    if (rows.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'history-empty'
      empty.textContent = messages.floatingHistoryEmpty
      historyList.append(empty)
      return
    }
    for (const item of rows) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = item.sessionId === sessionId ? 'history-row current' : 'history-row'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(item.sessionId === sessionId))
      button.textContent = overlayTitle(item, messages.floatingUntitledConversation)
      button.addEventListener('click', () => { void selectHistory(item.sessionId) })
      historyList.append(button)
    }
  }

  async function selectHistory(id) {
    setHistoryOpen(false)
    if (id !== sessionId) {
      try {
        await adoptSession(id)
      } catch {
        sessionId = undefined
        await createOrbSession()
      }
    }
    await refreshOverlay()
  }

  async function refreshOverlay() {
    try {
      const list = await rpc('session/list', { _request: {} })
      const items = list.items ?? []
      const row = sessionId === undefined ? undefined : items.find(item => item.sessionId === sessionId)
      setRunning(row?.running === true)
      if (historyOpen) {
        await renderHistory(items)
        return
      }
      if (sessionId === undefined) return
      const throughSeq = row?.projections?.asOfSeq ?? -1
      const page = await rpc('session/page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          maxMessages: 50,
        },
      })
      renderTranscript(page.records)
    } catch {
      status.textContent = messages.floatingDisconnected
    }
  }

  api.backend.subscribe(state => {
    status.textContent = state.phase === 'ready' ? '' : messages.floatingDisconnected
    if (state.phase === 'ready') void ensureSession().then(refreshOverlay)
  })
  const backend = await api.backend.status()
  if (backend.phase === 'ready') {
    status.textContent = ''
    void ensureSession().then(refreshOverlay)
  } else {
    status.textContent = messages.floatingDisconnected
  }

  document.body.addEventListener('pointerenter', () => {
    if (dragging || collapsing) return
    void setExpanded(true)
  })
  document.body.addEventListener('pointerleave', () => {
    if (dragging || collapsing) return
    scheduleCollapse()
  })

  ball.addEventListener('pointerdown', event => {
    dragging = false
    collapsing = false
    lastOrigin = undefined
    pointer = { ...ballGrabOffset(event), startX: event.screenX, startY: event.screenY }
    ball.setPointerCapture(event.pointerId)
  })
  ball.addEventListener('pointermove', event => {
    if (pointer === undefined) return
    lastOrigin = { x: event.screenX - pointer.dx, y: event.screenY - pointer.dy }
    if (!dragging) {
      if (Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) <= 4) return
      dragging = true
      collapsing = true
      pinned = false
      document.body.classList.remove('pinned')
      void setExpanded(false, true).then(() => {
        collapsing = false
        if (dragging && lastOrigin !== undefined) void api.floating.move(lastOrigin.x, lastOrigin.y)
      })
      return
    }
    if (!collapsing) void api.floating.move(lastOrigin.x, lastOrigin.y)
  })
  async function finishPointer(event) {
    if (dragging) {
      dragging = false
      collapsing = false
      const origin = pointer === undefined
        ? lastOrigin
        : { x: event.screenX - pointer.dx, y: event.screenY - pointer.dy }
      pointer = undefined
      lastOrigin = undefined
      if (origin !== undefined) await api.floating.move(origin.x, origin.y)
      await api.floating.clamp()
      return true
    }
    pointer = undefined
    lastOrigin = undefined
    return false
  }
  ball.addEventListener('pointerup', async event => {
    if (await finishPointer(event)) return
    pinned = !pinned
    document.body.classList.toggle('pinned', pinned)
    if (pinned) await setExpanded(true)
  })
  ball.addEventListener('pointercancel', event => {
    void finishPointer(event)
  })

  document.querySelector('#composer').addEventListener('submit', async event => {
    event.preventDefault()
    const text = prompt.value.trim()
    if (text === '') return
    prompt.value = ''
    setHistoryOpen(false)
    const id = await ensureSession()
    setRunning(true)
    await rpc('session/prompt', {
      request: {
        requestId: rpcId(),
        sessionId: id,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
    })
    await refreshOverlay()
  })
  stop.addEventListener('click', async () => {
    if (sessionId === undefined) return
    await rpc('session/cancel', { request: { sessionId } })
    await refreshOverlay()
  })
  historyButton.addEventListener('click', async () => {
    setHistoryOpen(!historyOpen)
    await refreshOverlay()
  })
  document.querySelector('#new-conversation').addEventListener('click', async () => {
    prompt.value = ''
    transcript.replaceChildren()
    setHistoryOpen(false)
    setRunning(false)
    await createOrbSession()
    await refreshOverlay()
  })
  syncGif()
  setInterval(() => { void refreshOverlay() }, 1500)
}

void main()
