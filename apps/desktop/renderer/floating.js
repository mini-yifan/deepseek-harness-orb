const api = window.dshDesktop
const VISION_MODEL = 'deepseek-v4-flash-vision-exp'

function rpcId() {
  return crypto.randomUUID()
}

async function rpc(method, request) {
  const id = rpcId()
  const args = request === undefined ? {} : { request }
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

function pickVision(catalog) {
  for (const group of catalog.groups ?? []) {
    const exact = group.models.find(model => model.id === VISION_MODEL)
    if (exact) return { provider: group.id, model: exact.id }
  }
  for (const group of catalog.groups ?? []) {
    const vision = group.models.find(model => String(model.id).includes('vision'))
    if (vision) return { provider: group.id, model: vision.id }
  }
  return undefined
}

function eventText(record) {
  const event = record?.event
  if (event === undefined) return ''
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return ''
  const data = event.data ?? {}
  const content = data.content ?? data.message?.content ?? []
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function main() {
  const locale = await api.locale()
  const messages = locale.messages
  document.documentElement.lang = locale.id
  document.querySelector('#page-title').textContent = messages.floatingTitle
  document.querySelector('#prompt').placeholder = messages.floatingPlaceholder
  document.querySelector('#stop').textContent = messages.floatingStop
  document.querySelector('#send').textContent = messages.floatingSend
  document.querySelector('#input-label').textContent = messages.floatingPlaceholder
  const ball = document.querySelector('#ball')
  const panel = document.querySelector('#panel')
  const transcript = document.querySelector('#transcript')
  const status = document.querySelector('#status')
  const prompt = document.querySelector('#prompt')
  const stop = document.querySelector('#stop')
  let sessionId = await api.floating.sessionId()
  let dragging = false
  let pointer = undefined

  function setExpanded(expanded) {
    document.body.classList.toggle('expanded', expanded)
    panel.hidden = !expanded
  }

  async function selectVision(id) {
    try {
      const catalog = await rpc('session/modelCatalog')
      const vision = pickVision(catalog)
      if (vision !== undefined) {
        await rpc('session/selectModel', { sessionId: id, provider: vision.provider, model: vision.model })
      }
    } catch {
      // A missing catalog or unsupported route leaves the session on its deployment default.
    }
  }

  async function ensureSession() {
    if (sessionId !== undefined) {
      try {
        await rpc('session/create', { sessionId, agentPreset: 'computer-use' })
        await selectVision(sessionId)
        return sessionId
      } catch {
        // A persisted id that the Host no longer holds is replaced below.
        sessionId = undefined
      }
    }
    const created = await rpc('session/create', { agentPreset: 'computer-use' })
    sessionId = created.sessionId
    await api.floating.setSessionId(sessionId)
    await selectVision(sessionId)
    return sessionId
  }

  async function refreshTranscript() {
    if (sessionId === undefined) return
    try {
      const page = await rpc('session/page', {
        address: { kind: 'session', sessionId },
        throughSeq: Number.MAX_SAFE_INTEGER,
      })
      const lines = (page.records ?? []).map(eventText).filter(line => line !== '')
      transcript.textContent = lines.join('\n\n')
    } catch {
      status.textContent = messages.floatingDisconnected
    }
  }

  api.backend.subscribe(state => {
    status.textContent = state.phase === 'ready' ? '' : messages.floatingDisconnected
    if (state.phase === 'ready') void ensureSession().then(refreshTranscript)
  })
  const backend = await api.backend.status()
  if (backend.phase === 'ready') {
    status.textContent = ''
    void ensureSession().then(refreshTranscript)
  } else {
    status.textContent = messages.floatingDisconnected
  }

  ball.addEventListener('pointerdown', event => {
    dragging = false
    pointer = { x: event.screenX, y: event.screenY, dx: event.clientX, dy: event.clientY }
    ball.setPointerCapture(event.pointerId)
  })
  ball.addEventListener('pointermove', event => {
    if (pointer === undefined) return
    if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 4) dragging = true
    if (dragging) void api.floating.move(event.screenX - pointer.dx, event.screenY - pointer.dy)
  })
  ball.addEventListener('pointerup', async () => {
    pointer = undefined
    if (dragging) await api.floating.dock()
    else setExpanded(await api.floating.toggle())
  })

  document.querySelector('#composer').addEventListener('submit', async event => {
    event.preventDefault()
    const text = prompt.value.trim()
    if (text === '') return
    prompt.value = ''
    const id = await ensureSession()
    await rpc('session/prompt', {
      requestId: rpcId(),
      sessionId: id,
      mode: 'queue',
      content: [{ type: 'text', text }],
    })
    await refreshTranscript()
  })
  stop.addEventListener('click', async () => {
    if (sessionId === undefined) return
    await rpc('session/cancel', { sessionId })
    await refreshTranscript()
  })
  setInterval(() => { void refreshTranscript() }, 1500)
}

void main()
