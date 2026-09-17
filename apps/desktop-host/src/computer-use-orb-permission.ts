/**
 * Desktop Host plugin that pins the overlay Access preset on floating-orb sessions.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-orb-permission
 */

import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'

/** Directory name of the overlay workspace under the Harness home. */
export const ORB_WORKSPACE_NAME = 'dsh_orb'

/** Access presets Electron may push for overlay Computer Use and background `code_agent`. */
export const ORB_PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const

/** One overlay Access preset id. */
export type OrbPermissionPreset = (typeof ORB_PERMISSION_PRESETS)[number]

/** Shipped overlay Access until Electron pushes a stored preference. */
export const DEFAULT_ORB_PERMISSION_PRESET: OrbPermissionPreset = 'danger-full-access'

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-orb-permission'

export const inject = ['permissionPresets', 'sessions']

let preset: OrbPermissionPreset = DEFAULT_ORB_PERMISSION_PRESET
let live: {
  readonly presets: Pick<PermissionPresetService, 'set'>
  readonly sessions: { get(id: SessionId): Session | undefined }
} | undefined

/**
 * True when `value` is one of {@link ORB_PERMISSION_PRESETS}.
 * @param value - Host IPC payload.
 * @returns whether `value` may replace the live overlay Access preset.
 */
export function isOrbPermissionPreset(value: unknown): value is OrbPermissionPreset {
  return typeof value === 'string'
    && (ORB_PERMISSION_PRESETS as readonly string[]).includes(value)
}

/**
 * Absolute overlay workspace path.
 * @param dshHome - Harness home; omitted, {@link resolveDshHome} is used.
 * @returns `dshHome` joined with {@link ORB_WORKSPACE_NAME}.
 */
export function orbWorkspacePath(dshHome: string = resolveDshHome()): string {
  return join(dshHome, ORB_WORKSPACE_NAME)
}

/**
 * Replace the live overlay Access preset used on later matching creates.
 * When `sessionId` names an attached orb session, pin that session immediately.
 * @param next - Electron-pushed preset.
 * @param sessionId - overlay session to pin; omitted, only later creates use `next`.
 */
export function setOrbPermissionPreset(next: OrbPermissionPreset, sessionId?: string): void {
  preset = next
  if (live === undefined || sessionId === undefined) return
  const session = live.sessions.get(SessionId(sessionId))
  if (session === undefined) return
  pinOrbWorkspacePermission(live.presets, session, next)
}

/**
 * Live overlay Access preset.
 * @returns the Electron-pushed value, or {@link DEFAULT_ORB_PERMISSION_PRESET} before the first push.
 */
export function currentOrbPermissionPreset(): OrbPermissionPreset {
  return preset
}

/**
 * Restore the shipped Full access default. Tests reset module state between cases.
 * @returns nothing; module state is {@link DEFAULT_ORB_PERMISSION_PRESET} afterwards.
 */
export function clearOrbPermissionPreset(): void {
  preset = DEFAULT_ORB_PERMISSION_PRESET
  live = undefined
}

function isOrbWorkspaceSession(session: Session, orbCwd: string): boolean {
  const agentPreset = session.header.agentPreset
  return (agentPreset === 'computer-use' || agentPreset === 'standard')
    && session.header.cwd !== undefined
    && resolve(session.header.cwd) === resolve(orbCwd)
}

/**
 * Pin the live overlay Access preset when the session is Computer Use or standard on the orb workspace.
 * `set` appends nothing when that preset is already current.
 * @param presets - permission preset service.
 * @param session - newly created session.
 * @param next - preset to pin; omitted, {@link currentOrbPermissionPreset}.
 * @param orbCwd - orb workspace path; omitted, {@link orbWorkspacePath}.
 */
export function pinOrbWorkspacePermission(
  presets: Pick<PermissionPresetService, 'set'>,
  session: Session,
  next: OrbPermissionPreset = currentOrbPermissionPreset(),
  orbCwd: string = orbWorkspacePath(),
): void {
  if (!isOrbWorkspaceSession(session, orbCwd)) return
  presets.set(session, next)
}

/**
 * Pin matching sessions on create. Already-listed sessions keep their last logged preset until overlay work reapplies.
 * @param ctx - Host context with `permissionPresets` and `sessions` (from {@link inject}).
 */
export function apply(ctx: Context): void {
  live = { presets: ctx.permissionPresets, sessions: ctx.sessions }
  ctx.on('session/created', (session: Session) => {
    pinOrbWorkspacePermission(ctx.permissionPresets, session)
  })
}
