# Agent Note: 仅在规范仓库运行组织专属 GitHub Actions

Status: implemented

[English](2026-09-19-canonical-repository-org-only-workflows.md) | 中文

## 问题

四个工作流消费仅存在于 `deepseek-harness/deepseek-harness` 的组织凭证：Cloudflare Pages 预览 token、用于改写组织 Project 的 Issue GitHub App，以及真实 API e2e secret。对并非 GitHub fork 的独立副本（重命名后的克隆）上的同仓库 PR，GitHub 的 `pull_request.head.repo.fork` 为 false。这些副本因此会运行这些 job，并在空的 `client-id`、缺失的 Cloudflare token、或假定组织环境的准备步骤上失败，每次推送每个工作流发一封失败邮件，并消耗 Actions 分钟数。

## 决策

预览、Issue 策略、Issue 生命周期和真实 API e2e 这些 job 仅在 `github.repository == 'deepseek-harness/deepseek-harness'` 时运行。这与 [dsh 打包 job](../../../../.github/workflows/release.yml) 选择自托管 runner 时使用的仓库身份相同。job 级 `if:` 跳过会报告为成功检查，因此副本不会让必需状态失败，也不会发出失败邮件。

在规范仓库内部，Issue 生命周期没有事件类型级 skip：每次 `pull_request_review` 事件都将该检查列为成功，而不是灰色 skipped 片段；签发 token 与改写看板仍按步骤限制在 `changes_requested`。

真实 API e2e 在仓库判断之后保留现有的不可信 PR 合取条件，因此向规范仓库提出的 fork 与 Dependabot PR 仍会跳过。[真实 API e2e 决策](../testing/2026-06-19-real-api-e2e-ci.zh.md) 仍是 secret 暴露、`pull_request` 与 `pull_request_target` 以及缺失 secret 的 preflight 的权威。本笔记只负责哪些仓库可以运行消费组织凭证的工作流。

## 考虑过的替代方案

**在所需 secret 或变量为空时跳过。** 副本上空的 `CLOUDFLARE_API_TOKEN` 或 `DSH_ISSUE_APP_CLIENT_ID` 会跳过，但规范仓库上同样的空值也会跳过。真实 API e2e 已经拒绝这一点：缺失 secret 必须明确失败，以免自跳过套件报出虚假绿色。

**依赖 `head.repo.fork`。** 仅当 GitHub 将 head 仓库记录为 fork 时该标志为 true。独立副本及其上的同仓库 PR 不是 fork，因此现有 e2e skip 对它们不适用，而预览 / Issue job 从未有过该 skip。

**在 GitHub UI 中禁用工作流，或在副本上删除这些文件。** UI 禁用不在源树中，下一次推送 `.github/workflows/` 就会覆盖。在副本上删除文件会与每次从上游合并冲突。

**只限制 `pull_request`，让 `push`/`schedule` 继续运行。** 副本仍会在 master 推送和每夜 schedule 上让 e2e 失败，而这是另一类失败邮件来源。

## 后果

独立副本在每种触发上都会跳过这四个 job，包括 master 推送和 schedule。它们不发布 Cloudflare 预览，不移动组织 Project 看板，也不运行计费的真实 API e2e。规范仓库的其余行为不变；e2e 的 `if:` 在不可信 PR 合取条件之外还包含仓库身份。

若要在副本上运行这些 job，必须使用规范仓库或更改此身份测试；只添加 secret 不够。

## 验证

[预览工作流回归](../../../../scripts/preview-workflow.spec.ts) 钉住预览 job 的仓库 `if:`。[CI 工作流回归](../../../../scripts/ci-workflow.spec.ts) 钉住 e2e、Issue 策略和 Issue 生命周期的 `if:` 值，并保持 Issue 生命周期没有事件类型级 job skip。
