# Agent Note: Overlay Computer Use 后台调度

Status: implemented

[English](2026-09-17-orb-code-agent-dispatch.md) | 中文

## 问题

悬浮球上的 Computer Use agent 可以把任务入队到一等 `code_agent` 会话，但每次新建都默认用整个 `$DSH_HOME/dsh_orb` 工作区，模型没有列出或停止这些会话的工具，续写可以对准任意 standard 会话 id，后台 Code agent 一旦调用 `ask_user_question` 或碰到批准提示就会堵在主窗口。

## 决策

`code_agent` 仍然只注册在 Computer Use 上，仍然用 `mode: 'queue'` 创建或续写一等 `standard` 会话，不设 `origin: 'subagent'`，也不传 `parentAgent`。[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造。[Computer Use 把 Code agent 完成通知停到空闲再投递](2026-09-15-computer-use-code-agent-completion.zh.md) 仍拥有停到空闲再投递的完成通知。本笔记拥有调度 cwd、调用方登记表、`code_agent_status` / `code_agent_stop`，以及 Code agent 上的无人值守应答。

新建时省略 `cwd` 会在 Computer Use 会话 cwd 下新建唯一子目录（`join(caller.cwd, slug)`）；`session.create` 本来就会 `mkdir` 该路径。用户点名了路径，或说了这里 / 这个文件夹 / 当前窗口且存在 `<frontmost_folder>` 时传入 `cwd`。用户说了这些词但访达不是最前窗口时，策略禁止调用 `code_agent`，并告诉用户去点那个访达窗口或给出路径。用户点名的文件夹或窗口与截图或 `<frontmost_folder>` 不一致时，在 Computer Use 会话上调用 `ask_user_question`；模型不得猜测，也不得退回 `dsh_orb`。短查询（天气、新闻标题），包括模型判断能落到要点的第二次搜索，留在 Computer Use 的 `web_search` / `web_fetch`。一段文件查找，以及用户要的文件（例如 HTML 调研报告），交给 `code_agent`。[Computer Use 后台职能](2026-09-22-computer-use-background-role.zh.md) 拥有这一划分，以及附在入队任务上的职能说明。

续写、查询和停止只接受这个 Computer Use 调用方启动过的会话 id。每次成功的新建或续写都把 `{ task, cwd, watches }` 记在以调用方 id 为键的表里，调用方销毁时丢掉。Overlay 新建是新的调用方，列表从空开始。主窗口会话永远不出现。

`code_agent_status` 返回数量、最新任务文本、cwd，以及 `running` 或 `idle`。已停止和已完成的会话保持 `idle`，以便续写。`code_agent_stop` 调用不带 `keepInbox` 的 `agent.cancel({ kind: 'user' })`，因此当前回合和已排队的追加都会结束，并中止该会话的完成监视，避免为被停掉的那一段再投递完成通知。会话仍然挂着。之后用同一 id 再调 `code_agent` 会再入队一轮并启动新的监视。球上的停止和 Host `session/cancel`（`keepInbox: true`）不变。

在活的 Code agent fiber 上前置 `approval/request` → `'allowed-once'`，以及 `user-questions/request` → 推荐项或第一项、plan-review 的 `intent.approve`，或一句要求 Code agent 停下并交出现有短结果的自由文本。Computer Use 自己仍在球上显示 `ask_user_question`。Overlay Access 仍然钉在 cwd 为 `dsh_orb` 或其真实子目录的 Computer Use 和 `standard` 会话上；出了这棵目录树的 cwd 留在 Host 默认（`workspace-write`）。Code agent 上的自动允许意味着即使起始预设是工作区内修改，沙箱升权请求也会被批准。

## 考虑过的替代方案

**继续把默认 cwd 设成整个 `dsh_orb` 工作区。** 并行任务会挤在同一个目录里。新建子目录把每件产物隔开。

**用 `ctx.jobs` 上的 `job_list` / `job_kill`。** 那会把工作从侧栏藏掉。查询和停止留在模型已经拿着的一等会话 id 上。

**让 Host `session/cancel` 使用 `keepInbox: false`。** 主窗口停止会丢掉已排队的追加。球上的停止必须只取消 Computer Use；后台停止是单独的工具。

**把 overlay 完全权限钉到每一个 `code_agent` cwd。** 点名的桌面或访达路径会把整台机器移出沙箱。那些会话留在普通的工作区内修改；无人值守允许覆盖批准提示。

**扫描每一个 `dsh_orb` standard 会话来做查询。** 那会看到主窗口对话和其他 overlay Computer Use 调用方。登记表归调用方所有。

## 后果

后台 Code agent 永远不等待人类，包括 overlay Access 芯片是只读、工人请求更宽沙箱的时候。重启 Desktop 会丢掉该 Computer Use 对话的内存登记表，直到它再启动新的 `code_agent` 会话；侧栏里剩下的会话还在，但球在该对话再次启动它们之前不能列出或停止。子目录新建传入原始 `cwd`，因此它们可能作为自己的侧栏工作区出现，而不是在 `dsh_orb` 标题下。

## 测试

包测试钉住省略 cwd 时的子目录新建、显式 cwd、只对本调用方 id 续写和停止、查询对另一个 Computer Use 调用方不可见、停止清空收件箱并中止完成通知、停止后续写，以及无人值守的批准 / 向用户提问应答。Desktop Host 测试把 overlay Access 钉在 orb 子目录上，并把 `dsh_orb` 的兄弟路径留着不钉。策略测试钉住天气对比一段文件查找、HTML 报告、访达不在最前时的询问，以及 status/stop 名称。computer-use snapshot 的 header pin 含有三个 `code_agent*` schema。
