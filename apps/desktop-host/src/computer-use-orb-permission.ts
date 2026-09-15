/**
 * Desktop Host plugin that pins Full access on floating-orb Computer Use sessions.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-orb-permission
 */

import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import type { Session } from '@deepseek-ai/dsh-session'

/** Directory name of the overlay workspace under the Harness home. */
export const ORB_WORKSPACE_NAME = 'dsh_orb'

/** Permission preset pinned on matching orb Computer Use sessions. */
const ORB_COMPUTER_USE_PRESET = 'danger-full-access'

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-orb-permission'

export const inject = ['permissionPresets', 'sessions']

/**
 * Absolute overlay workspace path.
 * @param dshHome - Harness home; omitted, {@link resolveDshHome} is used.
 * @returns `dshHome` joined with {@link ORB_WORKSPACE_NAME}.
 */
export function orbWorkspacePath(dshHome: string = resolveDshHome()): string {
  return join(dshHome, ORB_WORKSPACE_NAME)
}

function isOrbComputerUseSession(session: Session, orbCwd: string): boolean {
  return session.header.agentPreset === 'computer-use'
    && session.header.cwd !== undefined
    && resolve(session.header.cwd) === resolve(orbCwd)
}

/**
 * Pin Full access when the session is Computer Use on the orb workspace.
 * `set` appends nothing when that preset is already current.
 * @param presets - permission preset service.
 * @param session - announced or already-listed session.
 * @param orbCwd - orb workspace path; omitted, {@link orbWorkspacePath}.
 */
export function pinOrbComputerUseFullAccess(
  presets: Pick<PermissionPresetService, 'set'>,
  session: Session,
  orbCwd: string = orbWorkspacePath(),
): void {
  if (!isOrbComputerUseSession(session, orbCwd)) return
  presets.set(session, ORB_COMPUTER_USE_PRESET)
}

/**
 * Upgrade matching sessions on create and any sessions already in the store.
 * @param ctx - Host context with `permissionPresets` and `sessions` (from {@link inject}).
 */
export function apply(ctx: Context): void {
  const pin = (session: Session): void => {
    pinOrbComputerUseFullAccess(ctx.permissionPresets, session)
  }
  ctx.on('session/created', pin)
  for (const session of ctx.sessions.list()) pin(session)
}
