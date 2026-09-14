/** Copy the experimental Computer Use package into a Desktop runtime without an npm dependency. */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** npm name of the experimental Computer Use package copied as a runtime extra. */
export const COMPUTER_USE_PACKAGE = '@deepseek-ai/dsh-experimental-tool-computer-use'

const COMPOSITION = join('presets', 'computer-use', 'agent.cordis.yml')

/**
 * Absolute extra-package destination inside one Desktop runtime tree.
 * @param runtimeDir - immutable packages carried by the Electron application.
 * @returns the destination directory for the copied experimental package.
 */
export function computerUseRuntimeExtraDir(runtimeDir: string): string {
  return join(runtimeDir, 'node_modules', ...COMPUTER_USE_PACKAGE.split('/'))
}

/**
 * Copy built Computer Use files into a runtime `node_modules` tree and point
 * the extra preset composition at emitted JavaScript. Packaged Node loads no
 * TypeScript, so the source composition's `../../src/*.ts` entries become
 * `../../lib/*.js` only in this copy.
 * @param sourceDir - workspace `packages/experimental/tool-computer-use`.
 * @param runtimeDir - destination Desktop runtime root.
 * @returns the copied package directory.
 */
export function copyComputerUseRuntimeExtra(sourceDir: string, runtimeDir: string): string {
  const destDir = computerUseRuntimeExtraDir(runtimeDir)
  if (!existsSync(join(sourceDir, 'package.json'))) {
    throw new Error(`desktop runtime: Computer Use extra source is missing: ${sourceDir}`)
  }
  for (const entry of ['lib/index.js', 'lib/code-agent.js', 'lib/preset-root.js', COMPOSITION]) {
    if (!existsSync(join(sourceDir, entry))) {
      throw new Error(`desktop runtime: Computer Use extra is missing built ${entry}`)
    }
  }
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  cpSync(join(sourceDir, 'package.json'), join(destDir, 'package.json'))
  cpSync(join(sourceDir, 'lib'), join(destDir, 'lib'), { recursive: true, dereference: true })
  cpSync(join(sourceDir, 'presets'), join(destDir, 'presets'), { recursive: true, dereference: true })
  const composition = join(destDir, COMPOSITION)
  mkdirSync(dirname(composition), { recursive: true })
  writeFileSync(composition, readFileSync(composition, 'utf8')
    .replaceAll("'../../src/index.ts'", "'../../lib/index.js'")
    .replaceAll("'../../src/code-agent.ts'", "'../../lib/code-agent.js'"))
  return destDir
}
