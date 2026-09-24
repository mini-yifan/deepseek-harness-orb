import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const existsSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync }
})

import { apply, PRESET_ROOT } from '../src/preset-root.ts'

describe('computer-use preset-root missing directory', () => {
  afterEach(() => {
    existsSync.mockReset()
  })

  it('fails loud when the extra root is missing', async () => {
    existsSync.mockReturnValue(false)
    const ctx = new Context()
    expect(() => apply(ctx)).toThrow(`computer-use: preset root is missing: ${PRESET_ROOT}`)
    await ctx.fiber.dispose()
  })
})
