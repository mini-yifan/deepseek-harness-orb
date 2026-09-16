const api = window.dshDesktop

function applyLanguage(language) {
  document.querySelector('#language-zh').setAttribute('aria-checked', language === 'zh' ? 'true' : 'false')
  document.querySelector('#language-en').setAttribute('aria-checked', language === 'en' ? 'true' : 'false')
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

  document.querySelector('#search').addEventListener('click', () => { void api.selection.search() })
  document.querySelector('#translate').addEventListener('click', () => { void api.selection.translate() })
  document.querySelector('#explain').addEventListener('click', () => { void api.selection.explain() })
  document.querySelector('#translate-arrow').addEventListener('click', event => {
    event.stopPropagation()
    const menu = document.querySelector('#language-menu')
    menu.hidden = !menu.hidden
  })
  document.querySelector('#language-zh').addEventListener('click', () => {
    document.querySelector('#language-menu').hidden = true
    void api.selection.setLanguage('zh')
  })
  document.querySelector('#language-en').addEventListener('click', () => {
    document.querySelector('#language-menu').hidden = true
    void api.selection.setLanguage('en')
  })
  document.addEventListener('click', event => {
    if (event.target.closest('#translate-group')) return
    document.querySelector('#language-menu').hidden = true
  })

  api.selection.onState(state => { applyLanguage(state.language) })
  applyLanguage('zh')
})()
