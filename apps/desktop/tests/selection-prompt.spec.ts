import { describe, expect, it } from 'vitest'
import {
  composeSelectionExplainPrompt,
  composeSelectionTranslatePrompt,
  DESKTOP_SELECTION_PREAMBLE,
  selectionSearchUrl,
} from '../src/selection-prompt.ts'

const PREAMBLE = 'Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.'

describe('selection prompt composition', () => {
  it('pins the Computer Use first-frame skip preamble', () => {
    expect(DESKTOP_SELECTION_PREAMBLE).toBe(PREAMBLE)
  })

  it('builds a Bing search URL', () => {
    expect(selectionSearchUrl('hello world')).toBe('https://www.bing.com/search?q=hello%20world')
  })

  it('composes translate and explain user messages on the preamble', () => {
    expect(composeSelectionTranslatePrompt('你好', 'en')).toBe(
      `${PREAMBLE}\n\nTranslate the following into English:\n\n你好`,
    )
    expect(composeSelectionTranslatePrompt('hello', 'zh')).toBe(
      `${PREAMBLE}\n\nTranslate the following into Chinese:\n\nhello`,
    )
    expect(composeSelectionExplainPrompt('hello')).toBe(
      `${PREAMBLE}\n\nExplain this text:\n\nhello`,
    )
  })
})
