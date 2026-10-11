---
kind: upgrade-guide
description: "The `@deepseek-ai/dsh-llm-deepseek` plugin is split into the `-api-key` and `-account` provider plugins, so profile rows that name the old package fail to load."
---

# The DeepSeek LLM plugin is split into `-api-key` and `-account`

English | [中文](guide.zh.md)

## Change

The single `@deepseek-ai/dsh-llm-deepseek` package no longer exists. In its place, `@deepseek-ai/dsh-llm-deepseek-api-key` registers the `deepseek-official` adapter from the credential store's API key, and `@deepseek-ai/dsh-llm-deepseek-account` registers the same provider from a signed-in DeepSeek account. Anyone whose profile, patch, or overlay names the old package observes a module-not-found failure at load. Base and the Web presets mount both new rows; the profile rows keep the `llm-deepseek` and `llm-deepseek-account` ids, and the default active model route is unchanged. A deployment that already resolves credentials only one way may disable the row it does not use.

## Migration

1. In `cordis.yml`, `$DSH_HOME/profiles/<name>/cordis.patch.yml`, and `--patch` overlays, replace every row whose `name` is `@deepseek-ai/dsh-llm-deepseek` with `@deepseek-ai/dsh-llm-deepseek-api-key`, keeping the row's `id`.
2. Keep or delete the `llm-deepseek-account` row according to whether the deployment signs in with a DeepSeek account. Add the row by the `-account` name when it was absent.
3. Confirm: `dsh` starts the profile with no module-not-found error, `dsh model` reports the expected routes, and one prompt against the selected model returns.
