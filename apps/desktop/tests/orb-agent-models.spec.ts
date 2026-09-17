import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_ORB_AGENT_MODEL,
  ORB_AGENT_MODELS_FILE,
  readOrbAgentModels,
  writeOrbAgentModels,
} from '../src/orb-agent-models.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('orb agent model persistence', () => {
  it('defaults both agents to Flash at Max when the file is missing or invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orb-models-'))
    roots.push(root)
    expect(readOrbAgentModels(root)).toEqual({
      overlay: DEFAULT_ORB_AGENT_MODEL,
      background: DEFAULT_ORB_AGENT_MODEL,
    })
    expect(readOrbAgentModels(join(root, 'missing'))).toEqual({
      overlay: DEFAULT_ORB_AGENT_MODEL,
      background: DEFAULT_ORB_AGENT_MODEL,
    })
    writeFileSync(join(root, ORB_AGENT_MODELS_FILE), '[]\n')
    expect(readOrbAgentModels(root)).toEqual({
      overlay: DEFAULT_ORB_AGENT_MODEL,
      background: DEFAULT_ORB_AGENT_MODEL,
    })
    writeFileSync(join(root, ORB_AGENT_MODELS_FILE), '{broken')
    expect(readOrbAgentModels(root)).toEqual({
      overlay: DEFAULT_ORB_AGENT_MODEL,
      background: DEFAULT_ORB_AGENT_MODEL,
    })
  })

  it('round-trips independent overlay and background selections', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orb-models-write-'))
    roots.push(root)
    writeOrbAgentModels(root, {
      overlay: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
      background: { provider: 'anthropic', model: 'glm-5.3' },
    })
    expect(JSON.parse(readFileSync(join(root, ORB_AGENT_MODELS_FILE), 'utf8'))).toEqual({
      overlay: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
      background: { provider: 'anthropic', model: 'glm-5.3' },
    })
    expect(readOrbAgentModels(root)).toEqual({
      overlay: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
      background: { provider: 'anthropic', model: 'glm-5.3' },
    })
  })

  it('falls back one side when that selection is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orb-models-partial-'))
    roots.push(root)
    writeFileSync(join(root, ORB_AGENT_MODELS_FILE), `${JSON.stringify({
      overlay: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
      background: { provider: '', model: 'x' },
    })}\n`)
    expect(readOrbAgentModels(root)).toEqual({
      overlay: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
      background: DEFAULT_ORB_AGENT_MODEL,
    })
  })
})
