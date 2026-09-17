# Agent Note: Overlay Computer Use background dispatch

Status: implemented

English | [中文](2026-09-17-orb-code-agent-dispatch.zh.md)

## Problem

The floating-ball Computer Use agent could enqueue a first-class `code_agent` session, but every new session defaulted to the whole `$DSH_HOME/dsh_orb` workspace, the model had no list or stop tool for those sessions, continue could target any standard session id, and a background Code agent that called `ask_user_question` or hit an approval prompt blocked on the main window.

## Decision

`code_agent` remains Computer Use-only and still creates or continues a first-class `standard` session with `mode: 'queue'`, no `origin: 'subagent'`, and no `parentAgent`. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay construction. [Computer Use parks Code agent completion](2026-09-15-computer-use-code-agent-completion.md) still owns the parked finish notice. This note owns dispatch cwd, the caller-owned registry, `code_agent_status` / `code_agent_stop`, and unattended answerers on the Code agent.

Omit `cwd` on create mints a unique subdirectory under the Computer Use session cwd (`join(caller.cwd, slug)`); `session.create` already `mkdir`s that path. Pass `cwd` when the user named a path, or said here / this folder / the current window and `<frontmost_folder>` is present. When the user said those words and Finder is not frontmost, policy forbids `code_agent` and tells the user to click that Finder window or give a path. A request that names a folder or window that does not match the screenshot or `<frontmost_folder>` uses `ask_user_question` on the Computer Use session; the model must not guess or fall back to `dsh_orb`. Short lookup (weather, headlines) stays on Computer Use `web_search` / `web_fetch`. Long research writes an HTML report through `code_agent`.

Continue, status, and stop accept only session ids this Computer Use caller started. Each successful create or continue records `{ task, cwd, watches }` on a map keyed by caller id, dropped when that caller disposes. Overlay New is a new caller, so its list starts empty. Main-window sessions never appear.

`code_agent_status` returns count, latest task text, cwd, and `running` or `idle`. Stopped and finished sessions stay `idle` so they can be continued. `code_agent_stop` calls `agent.cancel({ kind: 'user' })` without `keepInbox`, so the running turn and queued follow-ups die, then aborts that session's completion watches so a finish notice is not delivered for the stopped interval. The session stays attached. A later `code_agent` with the same id queues a new turn and starts a new watch. Overlay Stop and Host `session/cancel` (`keepInbox: true`) are unchanged.

On the live Code agent fiber, prepend `approval/request` → `'allowed-once'` and `user-questions/request` → recommended or first option, plan-review `intent.approve`, or a short free-text continue. Computer Use itself still shows `ask_user_question` on the ball. Overlay Access still pins Computer Use and `standard` sessions whose cwd is `dsh_orb` or a real subdirectory of it; cwd outside that tree stays the Host default (`workspace-write`). Auto-allow on the Code agent means a sandbox escalation is granted even when the starting preset is workspace-write.

## Alternatives considered

**Keep default cwd as the whole `dsh_orb` workspace.** Parallel tasks would share one directory. A minted subdirectory isolates each new artifact.

**`job_list` / `job_kill` on `ctx.jobs`.** That would hide the work from the sidebar. Status and stop stay on the first-class session id the model already holds.

**Host `session/cancel` with `keepInbox: false`.** Main-window Stop would drop queued follow-ups. Overlay Stop must stay Computer Use-only; background stop is a dedicated tool.

**Pin overlay Full access on every `code_agent` cwd.** Named Desktop or Finder paths would unsandbox the whole machine. Those sessions stay ordinary workspace-write; unattended allow covers the approval prompt.

**Scan every `dsh_orb` standard session for status.** That would show main-window chats and other overlay Computer Use callers. The registry is caller-owned.

## Consequences

A background Code agent never waits for a human, including when the overlay Access chip is Read Only and the worker requests a wider sandbox. Restarting Desktop drops the in-memory registry for that Computer Use chat until it starts new `code_agent` sessions; leftover sidebar sessions remain but the ball cannot list or stop them until they are started again from that chat. Subdirectory creates pass raw `cwd`, so they may appear as their own sidebar workspace rather than under the `dsh_orb` title.

## Testing

Package tests pin omit-cwd subdirectory create, explicit cwd, continue and stop only for this caller's ids, status hiding another Computer Use caller, stop clearing the inbox and aborting the completion notice, continue after stop, and unattended approval / ask-user answers. Desktop Host tests pin overlay Access on an orb subdirectory and leave a sibling of `dsh_orb` unchanged. Policy tests pin weather versus long research, HTML reports, Finder-absent ask, and the status/stop names. The computer-use snapshot header pin includes the three `code_agent*` schemas.
