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
 * Ordinary overlay user-message text that pairs a composer instruction with attached selection.
 * Does not start with {@link DESKTOP_SELECTION_PREAMBLE}, so Computer Use keeps first-frame capture.
 * @param instruction - text from the overlay composer.
 * @param selection - full selected source text.
 * @returns one user-message string.
 */
export function composeSelectionSendPrompt(instruction: string, selection: string): string {
  return `${instruction}\n\n${selection}`
}
