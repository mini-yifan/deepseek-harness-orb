/**
 * Overlay Compact Chat plugin, browser half: occupies `'root'` with Compact
 * ChatView when this document is `?surface=overlay`. The main window keeps
 * AppFrame. The floating-ball shell posts the orb Session id; this plugin
 * calls `sessions.open` without reloading.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  OVERLAY_READY_MESSAGE_TYPE,
  OVERLAY_SHELL_ORIGIN,
  overlayClientSurface,
  overlaySessionId,
  overlaySessionMessage,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { OverlayChatRoot } from './OverlayChatRoot.tsx'

/** Required services for the overlay root occupant and Session selection. */
export const inject = ['slots', 'sessions']

export type { OverlayChatRootProps } from './OverlayChatRoot.tsx'
export { OverlayChatRoot } from './OverlayChatRoot.tsx'

/**
 * Client plugin body: Compact Chat root and the shell Session-id bridge.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  if (!overlayClientSurface()) return

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
    },
  }, OverlayChatRoot), 'ui-overlay-chat: compact root')

  ctx.effect(() => {
    let pending: string | undefined
    const tryOpen = (id: string): void => {
      pending = id
      try {
        ctx.sessions.open(overlaySessionId(id))
        pending = undefined
      } catch (error) {
        // sessions.open throws until the Host list includes this orb id.
        if (!(error instanceof Error) || !/unknown session/.test(error.message)) throw error
      }
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== OVERLAY_SHELL_ORIGIN) return
      const message = overlaySessionMessage(event.data)
      if (message === undefined) return
      tryOpen(message.sessionId)
    }
    window.addEventListener('message', onMessage)
    const offList = ctx.sessions.list.subscribe(() => {
      if (pending !== undefined) tryOpen(pending)
    })
    window.parent.postMessage({ type: OVERLAY_READY_MESSAGE_TYPE }, OVERLAY_SHELL_ORIGIN)
    return () => {
      window.removeEventListener('message', onMessage)
      offList()
    }
  }, 'ui-overlay-chat: session bridge')
}
