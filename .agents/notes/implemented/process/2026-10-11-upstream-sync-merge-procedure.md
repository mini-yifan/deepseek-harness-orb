# Agent Note: Upstream sync merge procedure for the DeepSeek Orb fork

Status: implemented

English | [中文](2026-10-11-upstream-sync-merge-procedure.zh.md)

## Problem

This repository merges `upstream/master` (deepseek-ai/deepseek-harness) continuously while carrying the DeepSeek Orb product. The first such merge after the fork's base moved 1729 upstream commits across 58 conflicted files. Several conflicts repeat on every sync: upstream rewrites shared Electron-shell files (main.ts, host-process.ts, the desktop packaging scripts), the webserver, and every test fixture and expected-output file the product's behavior touches. A merge that resolves them ad hoc loses the floating ball, breaks its snapshots, or leaves repository gates red without an obvious cause.

## Decision

Merge upstream with `git merge --no-ff upstream/master` on a dedicated branch, then resolve conflicts by taking the upstream file as the base and re-applying the fork's delta with `git apply -3`, so upstream's refactors survive and the fork's additions land on top. The fork's additions are structural: `apps/desktop/src/floating-*`, `orb-*`, `selection-toolbar-*`, `observation-frame-window`, `tcc.ts`, `millifraction-coordinates*`, and `packages/experimental/tool-computer-use` — upstream never touches these paths, so a conflict there always means the surrounding context moved.

Rules this merge established, each with the reason it exists:

- **Semantic merges need both sides, not one.** `webserver` keeps upstream's TLS and host validation plus the fork's `listen: false` / `dispatch` carrier. `session-controller` keeps the `saveAsDefault` opt-out on top of upstream's background default persistence; the ball's model choices must never overwrite the deployment default. `ui-chat`'s `TranscriptViewPolicy` takes upstream's `defaultMode` second and the fork's `forceCompact` third.
- **Product copy stays DeepSeek Orb.** locale strings, test fixtures, expected menus, dialogs, and snapshots carry the fork's product name; merge upstream's text only where the fork had none.
- **Behavior the tests assume is load-bearing.** The activate handler keeps upstream's `hasVisibleWindows` restore and the fork's cursor-gated ball logic; the fake `BrowserWindow` in `main-startup.spec.ts` keeps upstream's mockable constant `getBounds` because upstream's onboarding-size test depends on it.
- **Frozen artifacts win wholesale.** An archived Agent Note paired across both trees restores to upstream's sealed content; archived notes are never merged.
- **Fixture files are inputs, not outputs.** The headless computer-use snapshot's `cordis.yml`, `cordis.snapshot.yml`, `session.v3.jsonl`, `system-prompt.expected.md`, and `tool-schemas.expected.json` follow upstream's current behavior: disable the renamed `llm-deepseek-api-key` row, drop the removed `{{cwd}}` clause, and accept the working-directory runtime-context section, the declared computer-use message source, and the regenerated tool schemas.
- **Regenerate, then re-record.** After resolving, run `pnpm run clean`, a full install, `pnpm run typecheck`, the `gen-*` catalog scripts, `pnpm run verify-translation-pairing --write <changed docs>`, and `pnpm run doc-sync`; the fork's sidecars use upstream's current record format and its generators own the stderr-visible catalogs.
- **Breaking changes the sync absorbs get an upgrade guide in the current version directory.** The llm-deepseek provider split and the terminal tool package rename had none upstream.

## Alternatives considered

Rebasing the fork onto upstream was rejected: it rewrites 106 orb commits, breaks the public fork history, and the repository prefers merge-forward for standalone branches. Resolving conflicts by taking the fork's side wholesale was rejected because upstream's Electron-shell restructure (tray, quit confirmation, settings, login-shell environment, package-manager arguments) is what the fork's product now runs on. Treating pre-existing red gates as merge damage was rejected: each was verified byte-identical to the pre-merge tree first.

## Consequences

Future upstream syncs follow the same procedure: merge-forward on a dedicated branch, upstream-as-base conflict resolution, regenerate catalogs, re-record pairing sidecars, and re-align the fork's fixtures before running the gates. Each sync re-checks the fork's additions against upstream's current behavior instead of assuming last time's resolution still holds.

## Status

The merge landed as `merge(upstream): sync with deepseek-harness v0.2.1-alpha.2, keep the DeepSeek Orb floating ball` on `main` (2026-10-11). Pre-existing fork failures are recorded in the handoff, not fixed silently: `apps/desktop-host/tests/overlay.spec.ts` expects an abandoned `config/desktop.cordis.patch.yml` overlay while the shipped design registers `ui-settings-orb` through the web-app patch, and `apps/desktop/tests/development-plugin-store.spec.ts` expects the pre-in-process market link layout. `pnpm run lint` reports 150 pre-existing errors in the fork's own files.
