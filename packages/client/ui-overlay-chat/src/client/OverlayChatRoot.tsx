/** Overlay Compact Chat root: ChatView only, no composer or AppFrame chrome. */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './OverlayChatRoot.module.css'

/** Full composed props for the overlay root occupant. */
export type OverlayChatRootProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'conversation.view'>

function ignoreView(_view: string, _focus: string): void {}

function ignoreRequest(): void {}

/**
 * Render Compact Chat for the overlay iframe's current Session.
 * @param props - root runtime share plus the conversation.view render seat.
 * @returns the overlay transcript shell.
 */
export function OverlayChatRoot({
  renderSlot, SessionProvider, useSessions,
}: OverlayChatRootProps) {
  const sessionId = useSessions(s => s.current)
  return (
    <div className={css.shell} data-conversation-scroll="" data-overlay-chat="">
      <SessionProvider empty={() => null}>
        {sessionId === undefined
          ? null
          : renderSlot('conversation.view', {
            viewRequest: null,
            openView: ignoreView,
            completeViewRequest: ignoreRequest,
          }, { only: 'chat' })}
      </SessionProvider>
    </div>
  )
}
