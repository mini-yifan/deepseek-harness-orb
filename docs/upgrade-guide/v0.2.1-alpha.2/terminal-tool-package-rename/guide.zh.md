---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-tool-terminal` 更名为 `@deepseek-ai/dsh-terminal`，bash 相关行独立为 `-terminal-bash` 包，profile 里指名旧包的行将无法加载。"
---

# 终端工具包已更名

[English](guide.md) | 中文

## 变更

已发布的 `@deepseek-ai/dsh-tool-terminal` 包不再存在。其持久终端工具改由 `@deepseek-ai/dsh-terminal` 提供，bash 专属行则独立打包为 `@deepseek-ai/dsh-terminal-bash`。凡在 profile、patch 或 overlay 中指名旧包的部署，都会在加载时遇到模块未找到错误。模型可见的工具名、会话事件与默认激活行为均不变。base 与 Web 预设挂载新的行；原先挂载旧工具的 profile，按同样方式挂载这两个新行即可。

## 迁移

1. 在 `cordis.yml`、`$DSH_HOME/profiles/<name>/cordis.patch.yml` 与 `--patch` overlay 中，把所有 `name` 为 `@deepseek-ai/dsh-tool-terminal` 的行替换为 `@deepseek-ai/dsh-terminal`，保持该行的 `id` 不变。
2. 部署使用 bash 终端行时，在其旁边添加 `@deepseek-ai/dsh-terminal-bash` 行；新行挂载好后，删除针对旧行 id 的 patch 条目。
3. 确认：`dsh` 启动该 profile 无模块未找到错误，且通过终端工具执行一次 bash 命令能报告其输出与退出码。
