# Agent Note: In-process Desktop webServer and Plugin Market

Status: implemented

English | [中文](2026-09-18-desktop-in-process-webserver-and-plugin-market.zh.md)

## Problem

dsh-market (`dshmarket` on npm) mounts `/dsh-market/*` on `ctx.webServer` and installs plugins through `desktopPnpm` when that service exists. Official Desktop disabled `webserver`, answered `/dsh-market` as SPA HTML or 405, and had no `desktopProfiles` / `desktopPnpm`. Unpackaged `start:desktop` also wiped `.desktop-build/development/project` on every launch and refused plugin mutations, so pinning the market into the hoist tree could not survive a restart.

## Decision

Desktop enables `@deepseek-ai/dsh-host-webserver` with `listen: false`. Activation does not bind a TCP port. `WebServer.dispatch(request)` matches named exact and prefix routes only and returns `undefined` for unmatched paths so Desktop keeps its SPA `assetHandler`. Fetch order is `/.dsh/remote-stream`, `/api/*`, `/plugins/*`, named `webServer.dispatch`, then SPA assets. Synthetic `IncomingMessage` headers forward `Host` and `Origin`; `dsh-app://app` uses `Host: app` and `Origin: dsh-app://app` so market `sameOrigin` POST checks pass.

Before Loader entries mount, Desktop Host provides `desktopProfiles.current = { name: 'desktop', dir }` and `desktopPnpm` with `runPlugin` / `runExternalMarketPluginInstall`. Those methods send Host→Electron `plugin-run` IPC (protocol 6). Electron runs bundled pnpm through `DesktopProjectManager.mutateWhileRunning` without stopping the Host, then the market UI tells the user to restart. GitHub, gist, git, file, and URL specs remain rejected.

Unpackaged launches persist external plugins in `$DSH_HOME/profiles/desktop` and relink them into the wiped hoist project. The linker then places each plugin's host peer packages from the hoist beside the store copies, because Node ESM realpath of a store plugin does not search the hoist `node_modules`. `start:desktop` pins `dshmarket@1.47.0` in that store. `--skip-build` rebuilds `@deepseek-ai/dsh-host-webserver` and `@deepseek-ai/dsh-client-modules` so Host loads `dispatch` and the `/plugins` carrier registration from those packages' `lib/index.js`. Client-modules registers that route through `ctx.get('webServer')` when the carrier is already provided, because Cordis property access requires inject on a plugin fiber. The market package is not a signed `DESKTOP_PROFILE_BUNDLES` member. Packaged default preinstall of the market is out of scope.

## Alternatives considered

- **Listen on loopback for market HTTP.** Desktop's product rule is no listening port. In-process Fetch dispatch preserves that rule and still runs node:http handlers.
- **Vendor dsh-market into `packages/` or `vendor/`.** The plugin is MIT-licensed npm and already a Cordis plugin. Consuming the published package avoids a second source tree and a copyright-file merge into first-party packages.
- **Stop the Host before market installs, as the plugin-management window does.** `/dsh-market/install` is a streaming HTTP response from the Host; stopping the Host cuts that stream. Host-alive mutation plus a user restart loads the new Loader entries because `client-hmr` stays disabled.
- **Spawn `dsh plugin --profile web`.** That writes `~/.dsh/profiles/web` and never reaches the Desktop profile. The CLI also refuses `--profile desktop`.
- **`pnpm add` into the development hoist tree.** That tree is a link farm rebuilt every `start:desktop`; mutating it corrupts workspace links. The persistent profile store is the pnpm project; the hoist only receives directory links. Host peers still have to be linked back into the store, because ESM realpath does not search the hoist.

## Consequences

Settings → Plugins can show Plugin Market after `start:desktop` once `dshmarket` is in the development store. Market installs of registry packages survive the next hoist rebuild. GitHub-only catalog entries fail with an explicit unsupported-spec error. Desktop still does not listen on TCP, still does not enable `web-runtime` or `client-hmr`, and still does not let the CLI manage `profile desktop`.

Tests cover `listen: false` with no TCPWRAP, `dispatch` prefix hits and misses, Host/Origin `sameOrigin` values, fetch order, development-store linking of `dshmarket` and its host peers, and `github:` rejection. GUI browse/install against awesome-dsh-plugin remains a local Desktop run.
