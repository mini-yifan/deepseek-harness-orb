import { describe, expect, it } from 'vitest'
import { deriveOrbAgentItems, markOrbAgentRead, type OrbAgentBookmark } from '../src/orb-agents.ts'

function bookmark(overrides: Partial<OrbAgentBookmark> & { sessionId: string }): OrbAgentBookmark {
  return {
    task: 'Write a report',
    cwd: '/tmp/dsh_orb/task',
    startedAt: 1,
    state: 'running',
    ...overrides,
  }
}

describe('deriveOrbAgentItems', () => {
  it('lists running bookmarks oldest first, then finished newest first', () => {
    const items = deriveOrbAgentItems([
      bookmark({ sessionId: 'run-new', startedAt: 20 }),
      bookmark({ sessionId: 'done-old', startedAt: 3, state: 'completed', endedAt: 10 }),
      bookmark({ sessionId: 'run-old', startedAt: 5 }),
      bookmark({ sessionId: 'done-new', startedAt: 4, state: 'stopped', endedAt: 30 }),
    ])
    expect(items.map(item => item.sessionId)).toEqual(['run-old', 'run-new', 'done-new', 'done-old'])
  })

  it('marks finished bookmarks unread until the strip opens them', () => {
    const items = deriveOrbAgentItems([
      bookmark({ sessionId: 'der-unread', state: 'completed', endedAt: 10, outcome: 'done' }),
      bookmark({ sessionId: 'der-running' }),
    ])
    expect(items.find(item => item.sessionId === 'der-running')?.unread).toBe(false)
    const finished = items.find(item => item.sessionId === 'der-unread')
    expect(finished?.unread).toBe(true)
    expect(finished?.outcome).toBe('done')
    expect(finished?.endedAt).toBe(10)
  })

  it('drops a finished bookmark the user already opened', () => {
    markOrbAgentRead('der-read')
    const items = deriveOrbAgentItems([
      bookmark({ sessionId: 'der-read', state: 'completed', endedAt: 10 }),
    ])
    expect(items).toEqual([])
  })

  it('keeps an opened session visible while it runs again', () => {
    markOrbAgentRead('der-resumed')
    const items = deriveOrbAgentItems([
      bookmark({ sessionId: 'der-resumed', startedAt: 40 }),
    ])
    expect(items.map(item => item.sessionId)).toEqual(['der-resumed'])
  })
})
