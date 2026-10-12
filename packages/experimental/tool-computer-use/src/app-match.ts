/**
 * `open_app` name matching.
 * Exact process base names win over titles. A title matches whole, from a word boundary, or
 * as one separator-delimited segment: a bare substring match would activate an unrelated
 * window ("source code" for "code"), while a prefix-only rule would miss the way Windows
 * names a document window after its app ("Document1 - Word" for "Word").
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/app-match
 */

/**
 * Separators Windows titles put between the document and the app name. Both sides must be
 * spaced, so `main.rs` stays one segment and never splits into `main` + `rs`.
 */
const TITLE_SEPARATORS = /\s[-–—|:]\s/u

/** One visible top-level window, front to back, as `activateApp` sees it. */
export interface AppMatchWindow {
  /** Process base name without `.exe`, any case. */
  readonly appName: string
  readonly title: string
}

/**
 * Pick the window `wanted` refers to, in z-order.
 * @param windows - visible top-level windows, front to back.
 * @param wanted - model-supplied app name.
 * @returns the index of the match, or undefined when nothing matches.
 */
export function selectAppWindow(windows: readonly AppMatchWindow[], wanted: string): number | undefined {
  const name = wanted.trim().toLowerCase()
  if (name === '') return undefined
  // Process names are what the model means when it names an app; a title match only
  // stands in when no process answers to `name`.
  const exact = windows.findIndex(window => window.appName.toLowerCase() === name)
  if (exact >= 0) return exact
  const titled = windows.findIndex(window => titleMatches(window.title.toLowerCase(), name))
  return titled >= 0 ? titled : undefined
}

/**
 * Title equals `wanted`, starts with it at a word boundary, or carries it as one
 * separator-delimited segment.
 * @param title - lowercased window title.
 * @param wanted - lowercased app name the model asked for.
 * @returns true when the title names that app.
 */
function titleMatches(title: string, wanted: string): boolean {
  if (title === wanted) return true
  if (title.startsWith(wanted) && !/[a-z0-9_]/u.test(title.charAt(wanted.length))) return true
  // "Document1 - Word" and "Docs - Google Chrome": the app name is the trailing segment.
  // Equality per segment is still far stricter than the old substring test.
  return title.split(TITLE_SEPARATORS).some(segment => segment.trim() === wanted)
}
