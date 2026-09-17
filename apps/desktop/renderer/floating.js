const api = window.dshDesktop
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

const OVERLAY_APP_ORIGIN = 'dsh-app://app'
const OVERLAY_INDEX_HREF = 'dsh-app://app/index.html?surface=overlay'
const OVERLAY_SESSION_MESSAGE_TYPE = 'dsh.overlay.session'
const OVERLAY_READY_MESSAGE_TYPE = 'dsh.overlay.ready'
const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access']

function composeSelectionSendPrompt(instruction, selection) {
  return `${instruction}\n\n${selection}`
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
  const permissionRoot = document.querySelector('#permission')
  const permissionButton = document.querySelector('#permission-button')
  const permissionLabel = document.querySelector('#permission-label')
  const permissionMenu = document.querySelector('#permission-menu')
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
  const selectionChip = document.querySelector('#selection-chip')
  const selectionChipText = document.querySelector('#selection-chip-text')
  const selectionChipDismiss = document.querySelector('#selection-chip-dismiss')
  selectionChipDismiss.textContent = '\u00d7'
  selectionChipDismiss.setAttribute('aria-label', messages.floatingSelectionDismiss)
  selectionChipDismiss.title = messages.floatingSelectionDismiss
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
  let overlayPermission = 'danger-full-access'
  try {
    const stored = await api.floating.overlayPermission?.()
    if (PERMISSION_PRESETS.includes(stored)) overlayPermission = stored
  } catch {
    // Missing Desktop IPC uses shipped Full access so overlay send still binds.
  }
  let workspaceId
  let orbWorkspacePath
  let historyOpen = false
  let permissionOpen = false
  let dragging = false
  let skipClick = false
  let collapsing = false
  let pinned = false
  let expanded = false
  let running = false
  let pointer = undefined
  let lastOrigin = undefined
  let collapseTimer = undefined
  let collapseFrame = undefined
  let attachedSelection = ''
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

  function hasSelectionChip() {
    return attachedSelection !== ''
  }

  function setAttachedSelection(text) {
    attachedSelection = text
    if (pageClosed()) return
    const show = attachedSelection !== ''
    selectionChip.hidden = !show
    document.body.classList.toggle('has-selection-chip', show)
    selectionChipText.textContent = attachedSelection
    syncGif()
  }

  function syncGif() {
    if (pageClosed()) return
    const gif = document.querySelector('#ball-gif')
    const play = expanded || running || asking() || hasSelectionChip()
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
      ensureTranscriptFrame()
      stop.hidden = !running
      syncGif()
      return
    }
    if (!force && (pinned || running || asking() || hasSelectionChip())) return
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
    if (pinned || running || asking() || dragging || hasSelectionChip()) return
    if (collapseTimer !== undefined) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      void setExpanded(false)
    }, COLLAPSE_MS)
  }

  async function selectOverlayModel(id, selected) {
    try {
      const overlay = selected ?? await api.floating.overlayModel()
      await rpc('session/selectModel', {
        request: {
          sessionId: id,
          provider: overlay.provider,
          model: overlay.model,
          ...(overlay.reasoningEffort === undefined ? {} : { reasoningEffort: overlay.reasoningEffort }),
          saveAsDefault: false,
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

  function postOverlaySession() {
    const frame = transcript.querySelector('iframe')
    if (frame === null || sessionId === undefined) return
    const target = frame.contentWindow
    if (target === null) return
    try {
      target.postMessage({ type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId }, OVERLAY_APP_ORIGIN)
    } catch (error) {
      // JSDOM and an iframe that has not yet loaded Compact Chat have no target origin.
      if (!(error instanceof TypeError)) throw error
    }
  }

  function ensureTranscriptFrame() {
    if (transcript.querySelector('iframe') !== null) return
    const frame = document.createElement('iframe')
    frame.title = messages.floatingTitle
    frame.src = OVERLAY_INDEX_HREF
    frame.addEventListener('load', postOverlaySession)
    transcript.append(frame)
    postOverlaySession()
  }

  async function persistSession(id) {
    sessionId = id
    orbSessionIds.add(id)
    await api.floating.setSessionId(id)
    await selectOverlayModel(id)
    postOverlaySession()
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

  function permissionText(preset) {
    if (preset === 'read-only') return messages.floatingAccessReadOnly
    if (preset === 'workspace-write') return messages.floatingAccessWorkspaceWrite
    return messages.floatingAccessFullAccess
  }

  function renderPermission() {
    if (permissionLabel === null || permissionButton === null || permissionMenu === null) return
    permissionLabel.textContent = permissionText(overlayPermission)
    permissionButton.setAttribute('aria-label', permissionText(overlayPermission))
    permissionButton.title = permissionText(overlayPermission)
    for (const option of permissionMenu.querySelectorAll('[data-preset]')) {
      option.setAttribute('aria-selected', String(option.dataset.preset === overlayPermission))
    }
  }

  function setPermissionOpen(next) {
    permissionOpen = next
    if (permissionMenu === null || permissionButton === null) return
    permissionMenu.hidden = !permissionOpen
    permissionButton.setAttribute('aria-expanded', String(permissionOpen))
  }

  async function persistOverlayPermission(id) {
    if (typeof api.floating.setOverlayPermission !== 'function') return
    await api.floating.setOverlayPermission(overlayPermission, id)
  }

  async function promptOverlay(text) {
    const id = await ensureSession()
    setRunning(true)
    try {
      await persistOverlayPermission(id)
    } catch {
      // Overlay send still queues when Access persist is unavailable.
    }
    await rpc('session/prompt', {
      request: {
        requestId: rpcId(),
        sessionId: id,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
    })
    await refreshOverlay()
  }

  function setHistoryOpen(next) {
    historyOpen = next
    historyList.hidden = !historyOpen
    historyButton.setAttribute('aria-pressed', String(historyOpen))
    if (historyOpen) setPermissionOpen(false)
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
    transcript.hidden = historyOpen
    if (showCard) renderQuestion(pending)
    syncGif()
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

  function isPrimaryButton(event) {
    return event.button === 0
  }

  function primaryButtonHeld(event) {
    return (event.buttons & 1) === 1
  }

  ball.addEventListener('pointerdown', event => {
    if (!isPrimaryButton(event)) return
    dragging = false
    collapsing = false
    skipClick = false
    lastOrigin = undefined
    pointer = { ...ballGrabOffset(event), startX: event.screenX, startY: event.screenY }
    ball.setPointerCapture(event.pointerId)
  })
  ball.addEventListener('pointermove', event => {
    if (pointer === undefined) return
    if (!primaryButtonHeld(event)) {
      void finishPointer(event)
      return
    }
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
      skipClick = true
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
    if (!isPrimaryButton(event)) {
      void finishPointer(event)
      return
    }
    const dragged = await finishPointer(event)
    if (dragged || skipClick) {
      skipClick = false
      return
    }
    pinned = !pinned
    document.body.classList.toggle('pinned', pinned)
    if (pinned) await setExpanded(true)
  })
  ball.addEventListener('pointercancel', event => {
    void finishPointer(event)
  })
  // Native overlay menus can swallow pointerup; lost capture must end the grab so hover cannot keep moving the window.
  ball.addEventListener('lostpointercapture', event => {
    void finishPointer(event)
  })

  api.floating.onSelectionPrompt(async payload => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (text === '') return
    setHistoryOpen(false)
    setPermissionOpen(false)
    await setExpanded(true, true)
    await promptOverlay(text)
  })
  api.floating.onSelectionAttach(async payload => {
    const text = typeof payload?.text === 'string' ? payload.text : ''
    if (text.trim() === '') return
    setHistoryOpen(false)
    setPermissionOpen(false)
    setAttachedSelection(text)
    await setExpanded(true, true)
    prompt.focus()
  })
  api.floating.onOverlayModel(selection => {
    if (sessionId === undefined) return
    void selectOverlayModel(sessionId, selection)
  })
  document.querySelector('#composer').addEventListener('submit', async event => {
    event.preventDefault()
    const instruction = prompt.value.trim()
    if (instruction === '') return
    prompt.value = ''
    const selection = attachedSelection
    if (selection !== '') setAttachedSelection('')
    const text = selection === '' ? instruction : composeSelectionSendPrompt(instruction, selection)
    setHistoryOpen(false)
    setPermissionOpen(false)
    await promptOverlay(text)
  })
  stop.addEventListener('click', async () => {
    if (sessionId === undefined) return
    await rpc('session/cancel', { request: { sessionId } })
    await refreshOverlay()
  })
  if (permissionMenu !== null && permissionButton !== null && permissionRoot !== null) {
    for (const preset of PERMISSION_PRESETS) {
      const item = document.createElement('li')
      const option = document.createElement('button')
      option.type = 'button'
      option.dataset.preset = preset
      option.setAttribute('role', 'option')
      option.textContent = permissionText(preset)
      option.addEventListener('click', async () => {
        overlayPermission = preset
        setPermissionOpen(false)
        renderPermission()
        try {
          await persistOverlayPermission(sessionId)
        } catch {
          // Chip selection stays local when Desktop persist is unavailable.
        }
      })
      item.append(option)
      permissionMenu.append(item)
    }
    renderPermission()
    permissionButton.addEventListener('click', (event) => {
      event.stopPropagation()
      setHistoryOpen(false)
      setPermissionOpen(!permissionOpen)
    })
    document.addEventListener('pointerdown', (event) => {
      if (permissionRoot.contains(event.target)) return
      setPermissionOpen(false)
    })
  }
  historyButton.addEventListener('click', async () => {
    setHistoryOpen(!historyOpen)
    await refreshOverlay()
  })
  window.addEventListener('message', (event) => {
    if (event.origin !== OVERLAY_APP_ORIGIN) return
    if (event.data?.type !== OVERLAY_READY_MESSAGE_TYPE) return
    postOverlaySession()
  })
  selectionChipDismiss.addEventListener('click', () => {
    setAttachedSelection('')
  })
  document.querySelector('#new-conversation').addEventListener('click', async () => {
    prompt.value = ''
    setHistoryOpen(false)
    setPermissionOpen(false)
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
