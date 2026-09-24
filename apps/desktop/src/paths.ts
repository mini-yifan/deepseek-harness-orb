/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Directory name and sidebar title for Computer Use overlay sessions. */
export const ORB_WORKSPACE_NAME = 'dsh_orb'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  /** Existing directory registered as the overlay Workspace titled `dsh_orb`. */
  readonly orbWorkspace: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveDshHome()): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    orbWorkspace: join(dshHome, ORB_WORKSPACE_NAME),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
