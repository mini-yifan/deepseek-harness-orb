---
description: "Desktop Settings page for the macOS floating ball: custom avatar, Floating-ball Agent and background Agent models, and the selection toolbar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

English | [中文](README.zh.md)

## Summary

This package adds a **Floating ball** page to Desktop Settings. Users change the ball image (GIF, PNG, or WebP, suggested 2 MB cap, with restore-to-default), the Floating-ball Agent model, the background `code_agent` model, and whether the selection toolbar is enabled. Each control writes the Desktop profile immediately. `dsh web` never shows the page. Windows still lists it, with every control disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Desktop Host overlay inserts this plugin. Open Settings in the main window and select **Floating ball**. Choosing an image copies it into the Desktop profile and updates the live ball. Floating-ball Agent and Background Agent pickers use the same Host `session/modelCatalog` groups as the ball's right-click menus. The selection switch starts or stops the macOS helper. Access, Open Main Window, and Quit stay on the native context menu.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The node half is an empty `apply` so the Loader can list the plugin. The browser half registers `settings.section` id `orb` at order 25. Catalog reads go through `ctx.remote.session.modelCatalog()`. Preference writes go through `window.dshDesktop.orb` on `dsh-app://app` (the app preload, not the shell startup bridge). Custom avatars live as profile `orb-avatar` plus `orb-avatar.json`; `dsh-app://app/orb-avatar` and `dsh-app://shell/orb-avatar` serve that file or the packaged GIF. Windows receives the same page with `supported: false`. The [Desktop orb Settings Agent Note](../../../.agents/notes/implemented/feature/2026-09-18-desktop-orb-settings.md) owns composition, the app preload, and the profile avatar.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop user guide](../../../docs/user/guide/desktop.md) — product-facing floating ball.
- [ui-settings-general](../ui-settings-general/README.md) — Settings shell that projects this section.
- [Desktop floating orb](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.md) — overlay window and Computer Use session.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package edits Desktop profile preferences for a human and registers nothing that reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the Desktop-only Settings page. They are current package constraints, not a floating-ball backlog.

- **Desktop composition only** — `dsh web` does not insert this plugin, so the nav row never appears there.
- **macOS writes** — Windows lists the page and disables every control; the native ball is not created.
- **No Access, Open Main, or Quit** — those remain on the ball's right-click menu.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers one Settings section and retains no Host-side state.
