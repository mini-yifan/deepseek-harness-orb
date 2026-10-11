---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-llm-deepseek` 插件被拆分为 `-api-key` 与 `-account` 两个提供方插件，profile 里指名旧包的行将无法加载。"
---

# DeepSeek LLM 插件被拆分为 `-api-key` 与 `-account`

[English](guide.md) | 中文

## 变更

单一的 `@deepseek-ai/dsh-llm-deepseek` 包不再存在。取而代之，`@deepseek-ai/dsh-llm-deepseek-api-key` 从凭据存储中的 API key 注册 `deepseek-official` 适配器，`@deepseek-ai/dsh-llm-deepseek-account` 从已登录的 DeepSeek 账户注册同一提供方。凡在 profile、patch 或 overlay 中指名旧包的部署，都会在加载时遇到模块未找到错误。base 与 Web 预设都会挂载这两个新行；profile 行的 id 仍为 `llm-deepseek` 与 `llm-deepseek-account`，默认激活的模型路由不变。只以一种方式解析凭据的部署，可以禁用不使用的那个行。

## 迁移

1. 在 `cordis.yml`、`$DSH_HOME/profiles/<name>/cordis.patch.yml` 与 `--patch` overlay 中，把所有 `name` 为 `@deepseek-ai/dsh-llm-deepseek` 的行替换为 `@deepseek-ai/dsh-llm-deepseek-api-key`，保持该行的 `id` 不变。
2. 按部署是否使用 DeepSeek 账户登录，保留或删除 `llm-deepseek-account` 行；原本没有该行却又需要账户登录时，按 `-account` 名新增。
3. 确认：`dsh` 启动该 profile 无模块未找到错误，`dsh model` 报告预期的路由，且对所选模型的一次提示正常返回。
