---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-tool-terminal` is renamed to `@deepseek-ai/dsh-terminal` with a separate `-terminal-bash` package, so profile rows that name the old package fail to load."
---

# The terminal tool package is renamed

English | [中文](guide.zh.md)

## Change

The published `@deepseek-ai/dsh-tool-terminal` package no longer exists. Its persistent-terminal tools now ship from `@deepseek-ai/dsh-terminal`, and the bash-specific row is packaged separately as `@deepseek-ai/dsh-terminal-bash`. Anyone whose profile, patch, or overlay names the old package observes a module-not-found failure at load. The tool names a model sees, the session events, and the default active behavior are unchanged. Base and the Web presets mount the new rows; a profile that mounted the old tool mounts the two new rows the same way.

## Migration

1. In `cordis.yml`, `$DSH_HOME/profiles/<name>/cordis.patch.yml`, and `--patch` overlays, replace every row whose `name` is `@deepseek-ai/dsh-tool-terminal` with `@deepseek-ai/dsh-terminal`, keeping the row's `id`.
2. Add the `@deepseek-ai/dsh-terminal-bash` row next to it when the deployment uses the bash terminal row. Remove patch entries that target the old row's id once the new rows are mounted.
3. Confirm: `dsh` starts the profile with no module-not-found error, and one bash command through the terminal tool reports its output and exit code.
