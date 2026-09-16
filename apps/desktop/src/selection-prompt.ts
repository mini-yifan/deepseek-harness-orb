/** Prompt text and search URL for Desktop selection-toolbar actions. */

/**
 * First line of a selection-toolbar user message.
 * Computer Use skips first-frame capture when a user turn starts with this exact line.
 */
export const DESKTOP_SELECTION_PREAMBLE =
  'Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.'

/** Translate target persisted in the Desktop profile. */
export type SelectionTranslateLanguage = 'zh' | 'en'

/**
 * Bing search URL for one selected string.
 * @param text - selected text, possibly empty.
 * @returns a Bing query URL.
 */
export function selectionSearchUrl(text: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`
}

/**
 * User-message text that translates selected text in the floating-ball Computer Use session.
 * @param text - selected source text.
 * @param language - destination language.
 * @returns one user-message string starting with {@link DESKTOP_SELECTION_PREAMBLE}.
 */
export function composeSelectionTranslatePrompt(
  text: string,
  language: SelectionTranslateLanguage,
): string {
  const target = language === 'en' ? 'English' : 'Chinese'
  return `${DESKTOP_SELECTION_PREAMBLE}\n\nTranslate the following into ${target}:\n\n${text}`
}

/**
 * User-message text that asks the floating-ball Computer Use session to explain selected text.
 * @param text - selected source text.
 * @returns one user-message string starting with {@link DESKTOP_SELECTION_PREAMBLE}.
 */
export function composeSelectionExplainPrompt(text: string): string {
  return `${DESKTOP_SELECTION_PREAMBLE}\n\nExplain this text:\n\n${text}`
}
