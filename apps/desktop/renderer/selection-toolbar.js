const api = window.dshDesktop

function applyLanguage(language) {
  document.querySelector('#language-zh').setAttribute('aria-checked', language === 'zh' ? 'true' : 'false')
  document.querySelector('#language-en').setAttribute('aria-checked', language === 'en' ? 'true' : 'false')
}

function placeMenu() {
  const group = document.querySelector('#translate-group')
  document.querySelector('#language-menu').style.left = `${String(group.offsetLeft)}px`
}

async function syncToolbarSize() {
  const bar = document.querySelector('#bar').getBoundingClientRect()
  const menu = document.querySelector('#language-menu')
  const menuRect = menu.hidden ? bar : menu.getBoundingClientRect()
  const left = Math.min(bar.left, menuRect.left)
  const top = Math.min(bar.top, menuRect.top)
  const layout = await api.selection.setContentSize({
    width: Math.max(1, Math.ceil(Math.max(bar.right, menuRect.right) - left)),
    height: Math.max(1, Math.ceil(Math.max(bar.bottom, menuRect.bottom) - top)),
  })
  document.body.classList.toggle('menu-above', layout.menuAbove)
}

void (async () => {
  const locale = await api.locale()
  const messages = locale.messages
  document.querySelector('#search').textContent = messages.selectionToolbarSearch
  document.querySelector('#translate').textContent = messages.selectionToolbarTranslate
  document.querySelector('#explain').textContent = messages.selectionToolbarExplain
  document.querySelector('#translate-arrow').setAttribute('aria-label', messages.selectionToolbarLanguage)
  document.querySelector('#language-zh').textContent = messages.selectionLanguageZh
  document.querySelector('#language-en').textContent = messages.selectionLanguageEn

  document.addEventListener('pointerdown', () => { void api.selection.interact() })
  document.querySelector('#search').addEventListener('click', () => { void api.selection.search() })
  document.querySelector('#translate').addEventListener('click', () => { void api.selection.translate() })
  document.querySelector('#explain').addEventListener('click', () => { void api.selection.explain() })
  document.querySelector('#translate-arrow').addEventListener('click', event => {
    event.stopPropagation()
    const menu = document.querySelector('#language-menu')
    menu.hidden = !menu.hidden
    if (!menu.hidden) placeMenu()
    void syncToolbarSize()
  })
  document.querySelector('#language-zh').addEventListener('click', () => {
    document.querySelector('#language-menu').hidden = true
    document.body.classList.remove('menu-above')
    void api.selection.setLanguage('zh')
    void syncToolbarSize()
  })
  document.querySelector('#language-en').addEventListener('click', () => {
    document.querySelector('#language-menu').hidden = true
    document.body.classList.remove('menu-above')
    void api.selection.setLanguage('en')
    void syncToolbarSize()
  })
  document.addEventListener('click', event => {
    if (event.target.closest('#translate-group')) return
    const menu = document.querySelector('#language-menu')
    if (menu.hidden) return
    menu.hidden = true
    document.body.classList.remove('menu-above')
    void syncToolbarSize()
  })

  api.selection.onState(state => { applyLanguage(state.language) })
  applyLanguage('zh')
})()
