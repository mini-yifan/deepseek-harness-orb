# Agent Note: Overlay Appearance follows Host

Status: implemented

English | [中文](2026-09-18-overlay-appearance-follows-host.zh.md)

## Problem

The macOS floating-ball expanded panel stayed light while the main window followed Settings Appearance (`light` / `dark` / `system`). The vanilla shell hardcoded a light palette, and overlay Compact Chat's ThemePresenter forced light so Host dark never painted the iframe.

## Decision

Overlay Compact Chat uses the same ThemePresenter path as the main window: it applies the Host-resolved snapshot (`system` already reduced to `light` or `dark`) and does not call `theme.setTheme`. After each apply, the iframe posts `{ type: 'dsh.overlay.theme', colorScheme }` to `dsh-app://shell`. [`floating.js`](../../../../apps/desktop/renderer/floating.js) treats that post as the authority for `html[data-ds-dark-theme]` and `color-scheme`. Before the iframe exists, the shell guesses from `prefers-color-scheme`, which matches the shipped `system` default. [`floating.css`](../../../../apps/desktop/renderer/floating.css) keeps the light `:root` variables and overrides them under `html[data-ds-dark-theme]` with the main-window dark surfaces (`rgb(21, 21, 23)` base, `rgb(35, 35, 36)` input). OverlayChatRoot paints `--dsw-alias-bg-base`. The 72px ball GIF and the selection toolbar stay as they are.

[Overlay Compact ChatView](2026-09-16-overlay-compact-chat.md) still owns the iframe Compact root. This note owns following Host Appearance without writing Host settings.

## Alternatives considered

**Keep ThemePresenter force-light.** That left the Compact transcript white after the main window switched to dark.

**Call `theme.setTheme` from the overlay.** That writes Host settings and would flip the main window. Document-local presentation already follows the snapshot.

**Read `$DSH_HOME/settings.yaml` in the Electron main process.** That would duplicate Host settings parsing in the desktop shell for a first paint that `prefers-color-scheme` already covers when preference is `system`.

**Drive the shell only from `prefers-color-scheme`.** An explicit Light or Dark choice would desync from the main window.

## Consequences

The first expand can flash the OS scheme when Appearance is an explicit Light or Dark that disagrees with the OS, until the iframe posts. Collapse keeps the iframe, so later expands stay in sync. The selection toolbar remains light-only.

## Testing

`ui-layout` overlay apply follows `setTheme('dark')` and posts `dsh.overlay.theme`. ThemePresenter has no force-light parameter. `session-controller` parses and rejects theme posts. `floating-renderer` pins dark CSS variables, `var(--white)` iframe background, matchMedia first paint, Host postMessage, and ignored foreign origins.
