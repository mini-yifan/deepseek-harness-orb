import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyComputerUseRuntimeExtra } from '../scripts/computer-use-runtime-extra.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Computer Use Desktop runtime extra', () => {
  it('copies built entries and rewrites the preset composition to JavaScript', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cu-extra-'))
    roots.push(root)
    const source = join(root, 'source')
    mkdirSync(join(source, 'lib'), { recursive: true })
    mkdirSync(join(source, 'presets', 'computer-use'), { recursive: true })
    writeFileSync(join(source, 'package.json'), '{"name":"@deepseek-ai/dsh-experimental-tool-computer-use"}\n')
    writeFileSync(join(source, 'lib', 'index.js'), 'export {}\n')
    writeFileSync(join(source, 'lib', 'code-agent.js'), 'export {}\n')
    writeFileSync(join(source, 'lib', 'preset-root.js'), 'export {}\n')
    writeFileSync(join(source, 'presets', 'computer-use', 'agent.cordis.yml'), [
      "- id: tool-computer-use\n  name: '../../src/index.ts'\n",
      "- id: tool-code-agent\n  name: '../../src/code-agent.ts'\n",
    ].join(''))
    const dest = copyComputerUseRuntimeExtra(source, join(root, 'runtime'))
    const composition = readFileSync(join(dest, 'presets', 'computer-use', 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain("'../../lib/index.js'")
    expect(composition).toContain("'../../lib/code-agent.js'")
    expect(composition).not.toContain('../../src/')
  })

  it('rejects a source tree that is missing built lib entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cu-extra-missing-'))
    roots.push(root)
    writeFileSync(join(root, 'package.json'), '{}\n')
    expect(() => copyComputerUseRuntimeExtra(root, join(root, 'runtime'))).toThrow(/missing built/u)
  })
})
