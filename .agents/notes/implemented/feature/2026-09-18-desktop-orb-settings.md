# Agent Note: Desktop Settings page for the floating ball

Status: implemented

English | [中文](2026-09-18-desktop-orb-settings.zh.md)

## Problem

Overlay avatar, Floating-ball Agent, background Agent, and selection-toolbar enablement lived only on the macOS ball's native context menu and in Desktop profile JSON. The main-window Settings panel had no page for those preferences, and `dsh web` must not grow a sixth nav row that cannot act.

## Decision

Desktop Host composition inserts `@deepseek-ai/dsh-client-ui-settings-orb` as `settings.section` id `orb` (order 25). [`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) does not list it, so `dsh web` never registers the row. Windows still loads the Desktop overlay: the page is visible, `supported` is false, and every control is disabled.

The main window is `dsh-app://app`. [`preload-app.ts`](../../../../apps/desktop/src/preload-app.ts) exposes `dshDesktop.orb` to that hostname and keeps the startup bridge on `shell`. New IPC uses `assertDesktopSender(..., ['app'])`. Non-darwin writes throw `dsh desktop: floating ball settings require macOS`.

Custom images copy into the profile as `orb-avatar` plus `orb-avatar.json` (GIF/PNG/WebP, 2 MB cap). `dsh-app://app/orb-avatar` and `dsh-app://shell/orb-avatar` serve that file or `deepseek-avatar-square.gif`. Overlay and background models still write `orb-agent-models.json`; the selection switch calls `SelectionToolbarController.setEnabled`. The millifraction-coordinates card confirms in Electron main and is owned by [Overlay Computer Use millifraction and pixel coordinate modes](2026-09-19-computer-use-session-coordinate-modes.md). Access, Open Main Window, and Quit stay on the native menu. Catalog reads stay on Host `session/modelCatalog`. The macOS Screen Recording and Accessibility card after millifraction is owned by [Desktop Orb TCC gate](2026-09-20-desktop-orb-tcc-gate.md).

## Alternatives considered

**Gate the section with `ctx.remote.$host.isLoopback`.** Loopback is not Desktop versus `dsh web`. A remote browser on localhost would see a page whose IPC does not exist.

**Put overlay preferences in Host `settings.yaml`.** The native menu and floating renderer already own Desktop profile JSON. A Host namespace would duplicate facts the Electron shell must still read.

**Register the section from `ui-overlay-chat`.** That package occupies overlay `'root'`. The Settings page runs in the main window, not the overlay iframe.

**A runtime `window.dshDesktop` check inside a web-app plugin.** `dsh web` would still download and apply the plugin. Desktop-only insert keeps the Web roster unchanged.

**Move Access, Open Main Window, and Quit into Settings.** Those are overlay-window actions, not durable preferences the main window should own.

## Consequences

Changing the ball image or models in Settings updates the live overlay without restarting. The native right-click menus remain the in-ball path for the same model and toolbar fields. Windows users see a disabled page instead of a missing nav row. Custom avatars are not packaged under `apps/desktop/renderer/`. `start:desktop` (`--skip-build`) rebuilds this package so Desktop Host can load `lib/`.

## Testing

Desktop unit tests cover avatar install/restore/2 MB rejection, `preload-app` exposing `dshDesktop.orb` only on `dsh-app://app`, `SelectionToolbarController.setEnabled`, and `floating.js` applying a pushed avatar URL. `ui-settings-orb` covers section registration, snapshot load, rejected picks, the Windows banner, and immediate writes. `dsh web` snapshots are unchanged.
