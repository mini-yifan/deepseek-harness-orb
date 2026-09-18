// @vitest-environment jsdom

/**
 * Overlay Compact Chat plugin: occupies root only on ?surface=overlay,
 * bridges the shell Session id, and leaves the main window untouched.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  OVERLAY_READY_MESSAGE_TYPE,
  OVERLAY_SESSION_MESSAGE_TYPE,
  OVERLAY_SHELL_ORIGIN,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { apply, inject, OverlayChatRoot } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import type { OverlayChatRootProps } from '../src/client/OverlayChatRoot.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const open = vi.fn()
  const listeners = new Set<() => void>()
  ctx.provide('sessions', {
    open,
    list: {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, open, listeners }
}

describe('ui-overlay-chat browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions'])
  })

  it('registers nothing on the main-window document', async () => {
    vi.stubGlobal('location', { search: '' })
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('root')).toHaveLength(0)
    expect(ctx.slots.spec('conversation.view')).toBeUndefined()
    expect(ctx.slots.spec('conversation.input.overlay')).toBeUndefined()
    await fiber.dispose()
  })

  it('occupies root with conversation.view on the overlay surface and fiber teardown removes it', async () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    const parent = vi.spyOn(window.parent, 'postMessage')
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('root')).toHaveLength(1)
    expect(ctx.slots.spec('conversation.view')).toEqual({ kind: 'list', scope: 'session' })
    expect(ctx.slots.spec('conversation.input.overlay')).toEqual({ kind: 'list', scope: 'session' })
    expect(parent).toHaveBeenCalledWith({ type: OVERLAY_READY_MESSAGE_TYPE }, OVERLAY_SHELL_ORIGIN)
    await fiber.dispose()
    expect(ctx.slots.entries('root')).toHaveLength(0)
    expect(ctx.slots.spec('conversation.view')).toBeUndefined()
    expect(ctx.slots.spec('conversation.input.overlay')).toBeUndefined()
  })

  it('opens the posted Session id without a reload', async () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    const { open, listeners } = await bench()
    window.dispatchEvent(new MessageEvent('message', {
      origin: OVERLAY_SHELL_ORIGIN,
      data: { type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 'session-orb' },
    }))
    expect(open).toHaveBeenCalledWith('session-orb')
    for (const listener of listeners) listener()
    expect(open).toHaveBeenCalledOnce()
  })

  it('retries open after the Host list publishes an unknown orb id', async () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    const { open, listeners } = await bench()
    open.mockImplementationOnce(() => {
      throw new Error('sessions.select: unknown session session-orb')
    })
    window.dispatchEvent(new MessageEvent('message', {
      origin: OVERLAY_SHELL_ORIGIN,
      data: { type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 'session-orb' },
    }))
    expect(open).toHaveBeenCalledOnce()
    for (const listener of listeners) listener()
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('ignores a post from another origin and a non-session payload', async () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    const { open } = await bench()
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://example.test',
      data: { type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 'session-orb' },
    }))
    window.dispatchEvent(new MessageEvent('message', {
      origin: OVERLAY_SHELL_ORIGIN,
      data: { type: 'other' },
    }))
    expect(open).not.toHaveBeenCalled()
  })

  it('rethrows an open failure that is not an unknown-session miss', async () => {
    vi.stubGlobal('location', { search: '?surface=overlay' })
    const { open, listeners } = await bench()
    open.mockImplementationOnce(() => {
      throw new Error('sessions.select: unknown session session-orb')
    })
    window.dispatchEvent(new MessageEvent('message', {
      origin: OVERLAY_SHELL_ORIGIN,
      data: { type: OVERLAY_SESSION_MESSAGE_TYPE, sessionId: 'session-orb' },
    }))
    open.mockImplementationOnce(() => {
      throw new Error('sessions.select: closed')
    })
    expect(() => {
      for (const listener of listeners) listener()
    }).toThrow('sessions.select: closed')
    open.mockImplementationOnce(() => {
      throw 1
    })
    expect(() => {
      for (const listener of listeners) listener()
    }).toThrow(1)
  })
})

describe('OverlayChatRoot', () => {
  it('hosts Compact Chat under a full-width overlay shell', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/client/OverlayChatRoot.module.css'),
      'utf8',
    )
    expect(css).toContain('--dsh-chat-content-width: 100%')
    expect(css).toContain('--dsh-composer-side-clearance: 0px')
    expect(css).toContain('[data-chat-turn-rail]')
    expect(css).toContain('.inputOverlay')
    expect(css).toContain('background: var(--dsw-alias-bg-base)')
    expect(css).toContain('background: transparent')
    expect(css).not.toContain('#ffffff')
    const view = vi.fn((
      _name: string,
      _owner: {
        openView: (view: string, focus: string) => void
        completeViewRequest: () => void
      },
      _options?: { only: string },
    ) => <span>chat</span>)
    const props = {
      useSessions: (select: (state: { current: string }) => unknown) => select({ current: 'session-orb' }),
      SessionProvider: ({
        children, empty,
      }: { children: unknown; empty?: () => unknown }) => {
        empty?.()
        return <>{children}</>
      },
      renderSlot: view,
    } as unknown as OverlayChatRootProps
    const rendered = render(<OverlayChatRoot {...props} />)
    expect(rendered.container.querySelector('[data-overlay-chat]')).not.toBeNull()
    expect(rendered.container.querySelector('[data-conversation-scroll]')).not.toBeNull()
    expect(view).toHaveBeenCalledWith('conversation.view', expect.objectContaining({
      viewRequest: null,
    }), { only: 'chat' })
    expect(view).toHaveBeenCalledWith('conversation.input.overlay', {})
    const seat = view.mock.calls[0]![1]
    seat.openView('chat', 'focus')
    seat.completeViewRequest()
    rendered.unmount()
  })

  it('renders no conversation.view until a Session is current', () => {
    const view = vi.fn()
    const props = {
      useSessions: (select: (state: { current: string | undefined }) => unknown) =>
        select({ current: undefined }),
      SessionProvider: ({
        children, empty,
      }: { children: unknown; empty?: () => unknown }) => {
        empty?.()
        return <>{children}</>
      },
      renderSlot: view,
    } as unknown as OverlayChatRootProps
    const rendered = render(<OverlayChatRoot {...props} />)
    expect(view).not.toHaveBeenCalled()
    rendered.unmount()
  })
})

describe('ui-overlay-chat node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})
