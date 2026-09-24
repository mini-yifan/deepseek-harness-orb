import { describe, expect, it } from 'vitest'
import {
  composeSelectionSendPrompt,
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

  it('composes translate user messages on the preamble and send-to-agent without it', () => {
    expect(composeSelectionTranslatePrompt('你好', 'en')).toBe(
      `${PREAMBLE}\n\nTranslate the following into English:\n\n你好`,
    )
    expect(composeSelectionTranslatePrompt('hello', 'zh')).toBe(
      `${PREAMBLE}\n\nTranslate the following into Chinese:\n\nhello`,
    )
    expect(composeSelectionSendPrompt('Explain this', 'hello')).toBe('Explain this\n\nhello')
    expect(composeSelectionSendPrompt('Explain this', 'hello').startsWith(PREAMBLE)).toBe(false)
  })
})
