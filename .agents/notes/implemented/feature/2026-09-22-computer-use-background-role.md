# Agent Note: Computer Use background role

Status: implemented

English | [中文](2026-09-22-computer-use-background-role.zh.md)

## Problem

The Computer Use policy named artifact types (a Word document, a PPT, a research report) and told the model to end the turn after `code_agent`. File search that ended in a click stayed on the floating ball, which then ran the bash and web search itself. When the ball did delegate, the standard coding agent treated the task as a project and wrote a long report. A second search often finds what the first missed, so a fixed call quota cannot mark the stretch.

## Decision

The Computer Use policy, the preset persona, the `code_agent` description, and the tool result tell the model to decide each stretch. Visible GUI, and a search or command that will answer or feed the next click, stay in this chat, including a second search the model expects will hit the point. A stretch of file search, and a requested file, document, spreadsheet, or site, goes to `code_agent`. The last step being a click does not keep the investigation on the ball.

After `code_agent` returns, a GUI action continues in that turn only when it does not need the background result. Otherwise the model tells the user the background agent is running and ends the turn. It still must not poll with `wait`, `long_wait`, or bash sleep. [Computer Use parks Code agent completion](2026-09-15-computer-use-code-agent-completion.md) still delivers the notice after both sessions are idle. On that notice the model decides again: remaining GUI, another stretch on the same `session_id`, then a short conclusion. It does not recite a long report.

`session.create` still uses `agentPreset: 'standard'`. `queuedTaskText` appends `BACKGROUND_ROLE` to the queued user message. The completion notice quotes the model task only. The standard preset persona is unchanged. [Overlay Computer Use background dispatch](2026-09-17-orb-code-agent-dispatch.md) still owns unattended answerers; the free-text answer tells the Code agent to stop and return the short result it has.

## Alternatives considered

**Refuse the second bash or the second web search on the Computer Use session.** The model is the one that knows a second search will hit the point. A quota would cut that search off and add an executor rule beside the prompt.

**Change the standard preset persona to demand a short answer.** Every sidebar coding session uses that preset. File production from the ball still needs that agent.

**Add a short-answer preset for delegated search.** File production and search would then split across presets. This cut keeps one standard session and puts the role on the queued message.

## Consequences

Nothing counts tool calls. A model can still keep digging on the ball or write a report after it is told to stop. The free-text answer applies only when the Code agent asks a question. A requested file still takes as long as the standard agent needs.

## Testing

`code-agent.spec.ts` pins the stretch sentences in `POLICY` and the tool description, queues `queuedTaskText(task)`, and checks the completion notice quotes the model task and not `BACKGROUND_ROLE`. The computer-use snapshot header pin carries the policy section and the `code_agent` schema.
