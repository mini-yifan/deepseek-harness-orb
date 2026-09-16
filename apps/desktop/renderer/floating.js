const api = window.dshDesktop
const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_REASONING = 'max'
const GIF_SRC = 'deepseek-avatar-square.gif'
const COLLAPSE_MS = 180
const ANIMATION_MS = 300
const REMOTE_STREAM_URL = 'dsh-app://app/.dsh/remote-stream'
const USER_QUESTION_CANCELLED = 'the user cancelled ask_user_question'
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

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

function parseRecommendedLabel(label) {
  return RECOMMENDED_SUFFIX.test(label)
    ? { label: label.replace(RECOMMENDED_SUFFIX, ''), recommended: true }
    : { label, recommended: false }
}

function emptyDrafts(questions) {
  return questions.map(() => ({ selected: [], custom: '', skipped: false }))
}

function draftAnswered(draft) {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

function draftCompleted(draft) {
  return draftAnswered(draft) || draft.skipped
}

function buildAnswer(questions, drafts) {
  return {
    answers: questions.map((item, index) => {
      const value = drafts[index]
      if (value.skipped) return { id: item.id, selected: [] }
      const custom = value.custom.trim()
      return {
        id: item.id,
        selected: custom === '' || item.multiSelect === true ? value.selected : [],
        ...(custom === '' ? {} : { custom }),
      }
    }),
  }
}

async function* readNdjson(response) {
  if (!response.ok || response.body === null) {
    throw new Error(`desktop stream transport failed: HTTP ${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  for (;;) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (line !== '') yield JSON.parse(line)
    }
    if (done) break
  }
  if (pending !== '') yield JSON.parse(pending)
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isComposing(event) {
  return event.isComposing === true || event.keyCode === 229
}

async function main() {
  const locale = await api.locale()
  const messages = locale.messages
  document.documentElement.lang = locale.id
  document.querySelector('#page-title').textContent = messages.floatingTitle
  document.querySelector('#prompt').placeholder = messages.floatingPlaceholder
  document.querySelector('#stop').setAttribute('aria-label', messages.floatingStop)
  document.querySelector('#stop').title = messages.floatingStop
  const newConversation = document.querySelector('#new-conversation')
  newConversation.setAttribute('aria-label', messages.floatingNewConversation)
  newConversation.title = messages.floatingNewConversation
  const historyButton = document.querySelector('#history')
  historyButton.setAttribute('aria-label', messages.floatingHistory)
  historyButton.title = messages.floatingHistory
  document.querySelector('#input-label').textContent = messages.floatingPlaceholder
  const ball = document.querySelector('#ball')
  const panel = document.querySelector('#panel')
  const transcript = document.querySelector('#transcript')
  const questionRoot = document.querySelector('#question')
  const questionEyebrow = document.querySelector('#question-eyebrow')
  const questionTitle = document.querySelector('#question-title')
  const questionDetail = document.querySelector('#question-detail')
  const questionOptions = document.querySelector('#question-options')
  const questionCustom = document.querySelector('#question-custom')
  const questionError = document.querySelector('#question-error')
  const questionPager = document.querySelector('#question-pager')
  const questionProgress = document.querySelector('#question-progress')
  const questionPrev = document.querySelector('#question-prev')
  const questionNextNav = document.querySelector('#question-next-nav')
  const questionSkip = document.querySelector('#question-skip')
  const questionContinue = document.querySelector('#question-continue')
  const questionCancel = document.querySelector('#question-cancel')
  const historyList = document.querySelector('#history-list')
  const status = document.querySelector('#status')
  const prompt = document.querySelector('#prompt')
  const stop = document.querySelector('#stop')
  questionCancel.textContent = '\u00d7'
  questionCancel.setAttribute('aria-label', messages.floatingQuestionCancel)
  questionCancel.title = messages.floatingQuestionCancel
  questionPrev.textContent = '\u2039'
  questionPrev.setAttribute('aria-label', messages.floatingQuestionPrev)
  questionNextNav.textContent = '\u203a'
  questionNextNav.setAttribute('aria-label', messages.floatingQuestionNext)
  questionSkip.textContent = messages.floatingQuestionSkip
  questionCustom.placeholder = messages.floatingQuestionCustomPlaceholder
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
  const orbSessionIds = new Set()
  const pendingBySession = new Map()
  const settledEventIds = new Set()
  let eventsAbort
  let eventsClientId
  let eventsBackoff = 500

  if (sessionId !== undefined) orbSessionIds.add(sessionId)

  function pageClosed() {
    return globalThis.document?.body == null
  }

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

  function currentPending() {
    return sessionId === undefined ? undefined : pendingBySession.get(sessionId)
  }

  function asking() {
    return currentPending() !== undefined
  }

  function syncGif() {
    if (pageClosed()) return
    const gif = document.querySelector('#ball-gif')
    const play = expanded || running || asking()
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
    if (pageClosed()) return
    document.body.classList.toggle('running', running)
    stop.hidden = !expanded || !running
    syncGif()
    void api.floating.setSessionRunning(running)
  }

  function applyDirection(state) {
    document.body.classList.toggle('expand-left', state.horizontal === 'left')
    document.body.classList.toggle('expand-right', state.horizontal === 'right')
    document.body.classList.toggle('expand-up', state.vertical === 'up')
    document.body.classList.toggle('expand-down', state.vertical === 'down')
  }

  async function setExpanded(next, force = false) {
    if (pageClosed()) return
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
    if (!force && (pinned || running || asking())) return
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
    if (pinned || running || asking() || dragging) return
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
    orbSessionIds.add(id)
    await api.floating.setSessionId(id)
    await selectDefaultModel(id)
    syncQuestion()
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
    historyList.hidden = !historyOpen
    historyButton.setAttribute('aria-pressed', String(historyOpen))
    syncQuestion()
  }

  function syncContinue(pending) {
    if (pageClosed()) return
    const draft = pending.drafts[pending.index]
    questionContinue.textContent = pending.index === pending.questions.length - 1
      ? messages.floatingQuestionSubmit
      : messages.floatingQuestionNext
    questionContinue.disabled = pending.busy || !draftAnswered(draft)
    questionSkip.disabled = pending.busy
    questionCancel.disabled = pending.busy
    questionPrev.disabled = pending.busy || pending.index === 0
    questionNextNav.disabled = pending.busy || pending.index === pending.questions.length - 1
    questionCustom.disabled = pending.busy
    questionCustom.hidden = false
    questionCustom.placeholder = messages.floatingQuestionCustomPlaceholder
    if (document.activeElement !== questionCustom) questionCustom.value = draft.custom
  }

  function renderQuestion(pending) {
    if (pageClosed()) return
    const item = pending.questions[pending.index]
    const draft = pending.drafts[pending.index]
    const hasHeader = typeof item.header === 'string' && item.header !== ''
    questionEyebrow.hidden = !hasHeader
    questionEyebrow.textContent = hasHeader ? item.header : ''
    questionTitle.textContent = item.question
    const hasDetail = typeof item.detail === 'string' && item.detail !== ''
    questionDetail.hidden = !hasDetail
    questionDetail.textContent = hasDetail ? item.detail : ''
    questionOptions.replaceChildren()
    const options = item.options ?? []
    questionOptions.setAttribute('role', item.multiSelect === true ? 'group' : 'radiogroup')
    for (const [optionIndex, option] of options.entries()) {
      const selected = draft.selected.includes(option.label)
      const display = parseRecommendedLabel(option.label)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = selected ? 'question-option selected' : 'question-option'
      button.setAttribute('role', item.multiSelect === true ? 'checkbox' : 'radio')
      button.setAttribute('aria-checked', String(selected))
      button.disabled = pending.busy
      const mark = document.createElement('span')
      mark.className = 'question-option-mark'
      mark.textContent = item.multiSelect === true ? (selected ? '\u2713' : '') : String(optionIndex + 1)
      const copy = document.createElement('span')
      copy.className = 'question-option-copy'
      const label = document.createElement('span')
      label.className = 'question-option-label'
      label.textContent = display.label
      copy.append(label)
      if (display.recommended) {
        const badge = document.createElement('span')
        badge.className = 'question-recommended'
        badge.textContent = messages.floatingQuestionRecommended
        copy.append(badge)
      }
      if (typeof option.description === 'string' && option.description !== '') {
        const description = document.createElement('span')
        description.className = 'question-option-description'
        description.textContent = option.description
        copy.append(description)
      }
      button.append(mark, copy)
      button.addEventListener('click', () => { chooseOption(option.label) })
      questionOptions.append(button)
    }
    questionPager.hidden = pending.questions.length <= 1
    questionProgress.textContent = `${String(pending.index + 1)} / ${String(pending.questions.length)}`
    const hasError = typeof pending.error === 'string' && pending.error !== ''
    questionError.hidden = !hasError
    questionError.textContent = hasError ? pending.error : ''
    syncContinue(pending)
  }

  function syncQuestion() {
    if (pageClosed()) return
    const pending = currentPending()
    const showCard = pending !== undefined && !historyOpen
    document.body.classList.toggle('asking', pending !== undefined)
    questionRoot.hidden = !showCard
    if (historyOpen) {
      transcript.hidden = true
    } else {
      transcript.hidden = showCard
    }
    if (showCard) renderQuestion(pending)
    syncGif()
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
    if (pageClosed()) return
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
      syncQuestion()
    } catch {
      status.textContent = messages.floatingDisconnected
    }
  }

  async function replyEvent(clientId, eventId, outcome) {
    await rpc('$events/result', { clientId, eventId, outcome })
  }

  function chooseOption(label) {
    const pending = currentPending()
    if (pending === undefined || pending.busy) return
    const item = pending.questions[pending.index]
    const draft = pending.drafts[pending.index]
    if (item.multiSelect === true) {
      draft.selected = draft.selected.includes(label)
        ? draft.selected.filter(entry => entry !== label)
        : [...draft.selected, label]
    } else {
      draft.selected = [label]
      draft.custom = ''
      if (pending.index < pending.questions.length - 1) pending.index += 1
    }
    draft.skipped = false
    pending.error = undefined
    renderQuestion(pending)
  }

  function submitPending(pending) {
    const missing = pending.drafts.findIndex(draft => !draftCompleted(draft))
    if (missing >= 0) {
      pending.index = missing
      pending.error = messages.floatingQuestionIncomplete
      renderQuestion(pending)
      return
    }
    pending.busy = true
    pending.error = undefined
    renderQuestion(pending)
    const answer = buildAnswer(pending.questions, pending.drafts)
    void replyEvent(pending.clientId, pending.eventId, { kind: 'result', value: answer }).then(() => {
      settledEventIds.add(pending.eventId)
      pendingBySession.delete(pending.agentId)
      syncQuestion()
    }).catch((cause) => {
      pending.busy = false
      pending.error = cause instanceof Error ? cause.message : String(cause)
      renderQuestion(pending)
    })
  }

  function continueFlow() {
    const pending = currentPending()
    if (pending === undefined || pending.busy) return
    const draft = pending.drafts[pending.index]
    if (!draftAnswered(draft)) {
      pending.error = messages.floatingQuestionUnanswered
      renderQuestion(pending)
      return
    }
    if (pending.index < pending.questions.length - 1) {
      pending.index += 1
      pending.error = undefined
      renderQuestion(pending)
      return
    }
    submitPending(pending)
  }

  function skipQuestion() {
    const pending = currentPending()
    if (pending === undefined || pending.busy) return
    pending.drafts[pending.index] = { selected: [], custom: '', skipped: true }
    pending.error = undefined
    if (pending.index < pending.questions.length - 1) {
      pending.index += 1
      renderQuestion(pending)
      return
    }
    submitPending(pending)
  }

  function cancelQuestion() {
    const pending = currentPending()
    if (pending === undefined || pending.busy) return
    pending.busy = true
    pending.error = undefined
    renderQuestion(pending)
    void replyEvent(pending.clientId, pending.eventId, {
      kind: 'rejected',
      error: {
        name: 'UserQuestionError',
        message: USER_QUESTION_CANCELLED,
        code: 'ASK_CANCELLED',
      },
    }).then(() => {
      settledEventIds.add(pending.eventId)
      pendingBySession.delete(pending.agentId)
      syncQuestion()
    }).catch((cause) => {
      pending.busy = false
      pending.error = cause instanceof Error ? cause.message : String(cause)
      renderQuestion(pending)
    })
  }

  async function handleRemoteFrame(frame) {
    if (frame?.type === 'cancel') {
      for (const [agentId, pending] of pendingBySession) {
        if (pending.eventId === frame.eventId) {
          pendingBySession.delete(agentId)
          syncQuestion()
        }
      }
      return
    }
    if (frame?.type !== 'waterfall') return
    if (eventsClientId === undefined || typeof frame.eventId !== 'string') return
    if (settledEventIds.has(frame.eventId)) return
    const agentId = frame.agentId
    if (frame.event !== 'user-questions/request' || typeof agentId !== 'string' || !orbSessionIds.has(agentId)) {
      try {
        await replyEvent(eventsClientId, frame.eventId, { kind: 'next' })
      } catch {
        // The Host already cancelled this event or replaced the generation.
      }
      return
    }
    const existing = pendingBySession.get(agentId)
    if (existing !== undefined && existing.eventId === frame.eventId) {
      existing.clientId = eventsClientId
      syncQuestion()
      return
    }
    const questions = Array.isArray(frame.request?.questions) ? frame.request.questions : []
    if (questions.length === 0) {
      try {
        await replyEvent(eventsClientId, frame.eventId, { kind: 'next' })
      } catch {
        // The Host already cancelled this event or replaced the generation.
      }
      return
    }
    pendingBySession.set(agentId, {
      agentId,
      clientId: eventsClientId,
      eventId: frame.eventId,
      questions,
      index: 0,
      drafts: emptyDrafts(questions),
      busy: false,
      error: undefined,
    })
    if (agentId === sessionId) {
      setHistoryOpen(false)
      void setExpanded(true)
    }
    syncQuestion()
  }

  async function pumpEvents(signal) {
    const response = await fetch(REMOTE_STREAM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: '$events', payload: { args: {} } }),
      signal,
    })
    for await (const frame of readNdjson(response)) {
      if (signal.aborted) return
      if (frame?.type === 'ready' && typeof frame.clientId === 'string') {
        eventsClientId = frame.clientId
        eventsBackoff = 500
        continue
      }
      await handleRemoteFrame(frame)
    }
  }

  async function runEvents(signal) {
    while (!signal.aborted) {
      try {
        await pumpEvents(signal)
        if (signal.aborted) return
      } catch {
        // Stream loss, parse failure, or a dropped generation; reconnect unless this controller aborted.
        if (signal.aborted) return
      }
      eventsClientId = undefined
      const wait = eventsBackoff + Math.floor(eventsBackoff * Math.random())
      eventsBackoff = Math.min(eventsBackoff * 2, 8000)
      try {
        await delay(wait, signal)
      } catch {
        // This generation was stopped.
        return
      }
    }
  }

  function startRemoteEvents() {
    if (eventsAbort !== undefined) return
    eventsAbort = new AbortController()
    eventsBackoff = 500
    void runEvents(eventsAbort.signal)
  }

  function stopRemoteEvents() {
    eventsAbort?.abort()
    eventsAbort = undefined
    eventsClientId = undefined
  }

  function connectWhenReady() {
    status.textContent = ''
    void ensureSession().then(() => {
      void refreshOverlay()
      startRemoteEvents()
    })
  }

  api.backend.subscribe(state => {
    status.textContent = state.phase === 'ready' ? '' : messages.floatingDisconnected
    if (state.phase === 'ready') connectWhenReady()
    else stopRemoteEvents()
  })
  const backend = await api.backend.status()
  if (backend.phase === 'ready') connectWhenReady()
  else status.textContent = messages.floatingDisconnected
  window.addEventListener('unload', stopRemoteEvents)

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

  api.floating.onSelectionPrompt(async payload => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (text === '') return
    setHistoryOpen(false)
    const id = await ensureSession()
    await setExpanded(true, true)
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
  questionCancel.addEventListener('click', cancelQuestion)
  questionSkip.addEventListener('click', skipQuestion)
  questionContinue.addEventListener('click', continueFlow)
  questionPrev.addEventListener('click', () => {
    const pending = currentPending()
    if (pending === undefined || pending.busy || pending.index === 0) return
    pending.index -= 1
    pending.error = undefined
    renderQuestion(pending)
  })
  questionNextNav.addEventListener('click', () => {
    const pending = currentPending()
    if (pending === undefined || pending.busy || pending.index === pending.questions.length - 1) return
    pending.index += 1
    pending.error = undefined
    renderQuestion(pending)
  })
  questionCustom.addEventListener('input', () => {
    const pending = currentPending()
    if (pending === undefined || pending.busy) return
    const item = pending.questions[pending.index]
    const draft = pending.drafts[pending.index]
    draft.custom = questionCustom.value
    draft.skipped = false
    if (item.multiSelect !== true) draft.selected = []
    pending.error = undefined
    questionError.hidden = true
    syncContinue(pending)
  })
  questionCustom.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  })
  syncGif()
  setInterval(() => { void refreshOverlay() }, 1500)
}

void main()
