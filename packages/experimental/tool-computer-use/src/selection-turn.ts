/**
 * Detect Desktop selection-toolbar user turns so first-frame capture can be omitted.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/selection-turn
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * First line of a Desktop selection-toolbar user message.
 * Desktop composes the same string; this package must not be imported from the Electron app.
 */
export const DESKTOP_SELECTION_PREAMBLE =
  'Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.'

function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Whether a claimed pre-step batch is a Desktop selection-toolbar user turn.
 * @param messages - messages the loop claimed for this step.
 * @returns true when a `source.kind === 'user'` message starts with {@link DESKTOP_SELECTION_PREAMBLE}.
 */
export function isDesktopSelectionTurn(
  messages: readonly { readonly content: readonly ContentBlock[]; readonly source: { readonly kind: string } }[],
): boolean {
  return messages.some(message =>
    message.source.kind === 'user' && textOf(message.content).startsWith(DESKTOP_SELECTION_PREAMBLE))
}
