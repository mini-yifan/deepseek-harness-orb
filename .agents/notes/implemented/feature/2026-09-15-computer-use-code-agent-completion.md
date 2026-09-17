# Agent Note: Computer Use parks Code agent completion

Status: implemented

English | [中文](2026-09-15-computer-use-code-agent-completion.zh.md)

## Problem

`code_agent` already enqueues a first-class standard session and returns `{ accepted: true }` without waiting for that session to finish. Nothing then tells the Computer Use caller when the background work ends, so the overlay model either keeps its turn open (the ball stays on Stop and hides the composer) or goes idle with no later report. The user cannot keep chatting with Computer Use while the Code session runs, and never hears what that session produced.

## Decision

After `session.prompt({ mode: 'queue' })` accepts, `code_agent` starts a watch owned by the calling Computer Use agent's `ctx.effect`, under `agents.withoutInitiator`. `execute` still returns immediately and does not take `exec.signal` into the watch, so a later Computer Use Stop does not cancel the first-class Code session. `code_agent_stop` aborts that watch so a cancelled turn does not later followup a finish notice; [Overlay Computer Use background dispatch](2026-09-17-orb-code-agent-dispatch.md) owns stop.

The Code interval runs from that prompt's durable `rpcId` through the next whole-agent idle. If the Code agent is still `idle` and the prompt remains in its inbox, the watch waits for `running` (or dispose) before `whenIdle()`, so an idle `whenIdle()` cannot resolve before the work starts. Extra sidebar prompts on that Code session delay the notice until that session is idle.

When the Code session is idle, the watch reads the last assistant text from `deriveMessages()`, waits until the Computer Use caller is idle, re-checks `agents.get(caller.id) === caller`, and `followup`s a `source.kind: 'plugin'` notice (`plugin: 'tool-code-agent'`, `form: 'notice'`). It does not `inject` into a running Computer Use turn. A missing live Code agent after accept, a disposed caller, or a replacement agent at the same id drops the notice without failing the tool.

Policy, the `code_agent` description, the tool result envelope, and the Computer Use persona tell the model to report that the background agent is running, end the turn, and not poll with `wait` or bash sleep; a later plugin notice is what it reports to the user.

[Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the GUI tools and the Computer Use preset. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay construction and first-class `code_agent` sessions.

## Alternatives considered

**Wrap `code_agent` in `ctx.jobs`.** tool-jobs injects a busy owner, teaches `job_output` / `job_kill`, and treats the work as owner-fenced background rather than a sidebar standard session. `code_agent` exists specifically to keep that session first-class.

**Await the Code turn inside `execute`.** That pins the Computer Use tool call for the whole background run, keeps the overlay `running`, and fights `isConcurrencySafe`.

**`inject` the notice into a busy Computer Use turn.** A running GUI turn cannot close over `next-step` inbox items, so a Code completion would extend or interrupt click/type work. Parked `followup` after `caller.whenIdle()` leaves that turn alone.

**Listen on the Computer Use standing `ctx.on('agent/status')`.** `agent/status` is scope-filtered to that agent. The Code session is a sibling standard agent with no `parentAgent`; the watch must subscribe on `code.ctx` (or equivalent `whenIdle()` on that Agent).

## Consequences

The overlay composer returns when Computer Use ends its turn after enqueue, so the user can send more GUI or chat work while the Code session runs. The completion notice is a synthetic user message on the Computer Use log; the model then tells the user the outcome. A Code session the user keeps chatting with in the sidebar delays that notice. A Code session that never returns to idle never delivers. Policy cannot stop a model that still calls `wait`.

## Testing

Package tests cover execute returning before Code idle, parking until the Computer Use caller is idle, waiting for a running→idle edge when the prompt is still queued, dropping the watch on caller dispose, skipping a missing live Code agent, and refusing a replacement caller at the same id. They also pin the new policy and description sentences. The computer-use snapshot header pin refreshes `system-prompt.expected.md` and `tool-schemas.expected.json`; the click-loop JSONL is unchanged because that overlay stubs `sessionController`.
