/** Shared Plugin Market identity for unpackaged pinning and packaged tarball seed. */

import { dirname, join } from 'node:path'

/** npm package name of the external Plugin Market bundle. */
export const DESKTOP_MARKET_PACKAGE = 'dshmarket'

/** Exact Plugin Market version pinned in development and packed into extraResources. */
export const DESKTOP_MARKET_VERSION = '1.50.0'

/** Registry spec installed when the Desktop profile lacks this exact version. */
export const DESKTOP_MARKET_SPEC = `${DESKTOP_MARKET_PACKAGE}@${DESKTOP_MARKET_VERSION}`

/** Filename of the packed market tarball next to the signed `dsh` resources. */
export const DESKTOP_MARKET_TARBALL = `${DESKTOP_MARKET_PACKAGE}-${DESKTOP_MARKET_VERSION}.tgz`

/**
 * Resolve the bundled market tarball beside a Desktop `dsh` resource tree.
 * @param dshDir - Absolute packaged or fixture `dsh` directory.
 * @returns Absolute tarball path under `plugins/`.
 */
export function bundledMarketTarballPath(dshDir: string): string {
  return join(dirname(dshDir), 'plugins', DESKTOP_MARKET_TARBALL)
}
