import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  clearOrbCodeAgentModelSelection,
  name,
  setOrbCodeAgentModelSelection,
} from '../src/computer-use-orb-code-agent-model.ts'

afterEach(() => {
  clearOrbCodeAgentModelSelection()
})

describe('computer-use-orb-code-agent-model plugin', () => {
  it('exports the overlay YAML plugin name', () => {
    expect(name).toBe('computer-use-orb-code-agent-model')
  })

  it('publishes the latest Electron-pushed background selection', () => {
    const ctx = new Context()
    apply(ctx)
    expect(ctx.orbCodeAgentModel.currentSelection()).toBeUndefined()
    setOrbCodeAgentModelSelection({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
    expect(ctx.orbCodeAgentModel.currentSelection()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
    setOrbCodeAgentModelSelection({ provider: 'anthropic', model: 'glm-5.3' })
    expect(ctx.orbCodeAgentModel.currentSelection()).toEqual({
      provider: 'anthropic',
      model: 'glm-5.3',
    })
  })
})
