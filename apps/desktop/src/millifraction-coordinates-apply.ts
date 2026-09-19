/** Confirm, persist, push, and create for overlay Computer Use coordinate encoding. */

import type { DesktopMessages } from './locale.ts'
import { orbCoordinateModeFor, type OrbCoordinateMode } from './millifraction-coordinates.ts'

/** Native-dialog copy the confirm step shows. */
export type MillifractionConfirmMessages = Pick<
  DesktopMessages,
  | 'millifractionConfirmTitle'
  | 'millifractionConfirmMessage'
  | 'millifractionConfirmDetail'
  | 'millifractionConfirmOk'
  | 'millifractionConfirmCancel'
>

/** Result of the shared menu/Settings apply path. */
export type MillifractionApplyResult =
  | { readonly applied: false }
  | { readonly applied: true; readonly enabled: boolean }

/** Native confirm dialog used by Electron main. */
export interface MillifractionConfirmDialog {
  /**
   * Show the confirm dialog.
   * @param options - locale-owned title, body, and buttons.
   * @returns true when the user confirms a new conversation.
   */
  show(options: {
    readonly title: string
    readonly message: string
    readonly detail: string
    readonly confirm: string
    readonly cancel: string
  }): Promise<boolean>
}

/**
 * Invert the Desktop millifraction default only after native confirm.
 * Cancel writes nothing, pushes nothing, and does not create a session.
 * @param input - requested enablement, current JSON, dialog, persist, Host, overlay New.
 * @returns whether JSON, Host, and overlay New ran.
 */
export async function applyMillifractionCoordinates(input: {
  readonly requestedEnabled: boolean
  readonly currentEnabled: boolean
  readonly messages: MillifractionConfirmMessages
  readonly dialog: MillifractionConfirmDialog
  readonly persist: (enabled: boolean) => void
  readonly pushHost: (mode: OrbCoordinateMode) => void
  readonly createOverlaySession: () => void
}): Promise<MillifractionApplyResult> {
  if (input.requestedEnabled === input.currentEnabled) return { applied: false }
  const confirmed = await input.dialog.show({
    title: input.messages.millifractionConfirmTitle,
    message: input.messages.millifractionConfirmMessage,
    detail: input.messages.millifractionConfirmDetail,
    confirm: input.messages.millifractionConfirmOk,
    cancel: input.messages.millifractionConfirmCancel,
  })
  if (!confirmed) return { applied: false }
  input.persist(input.requestedEnabled)
  input.pushHost(orbCoordinateModeFor(input.requestedEnabled))
  input.createOverlaySession()
  return { applied: true, enabled: input.requestedEnabled }
}
