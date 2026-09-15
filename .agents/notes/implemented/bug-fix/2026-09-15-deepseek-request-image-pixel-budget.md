# Agent Note: DeepSeek request-image pixel budget at the provider 1300×1300 cap

Status: implemented

English | [中文](2026-09-15-deepseek-request-image-pixel-budget.zh.md)

## Problem

The harness projected every DeepSeek vision request image to 640,000 total pixels. Flash vision processes about 1300×1300 total pixels and then token-caps one image at 1024. Computer Use screenshots and other vision attachments therefore lost UI detail the model could use; a typical 16:10 laptop preview was about 992×645.

## Decision

`DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET` is 1,690,000 (1300×1300). Catalog models `deepseek-flash` and `deepseek-v4-flash-vision-exp` inherit that omission default. A 16:10 Computer Use screenshot after 2048×2048 attachment normalization projects to about 1612×1047. A 2048×1024 normalized attachment projects to 1838×919. Attachment normalization and `imageMaxBytes` (1 MiB) are unchanged.

The budget is per catalog model, not per agent preset. Computer Use uses `deepseek-flash`, so a Computer Use-only override would still change every session on that route.

Do not raise the default above 1,690,000: the provider's v41 solver then shrinks the raster toward the 1024-token cap, so extra encoded pixels are not extra visible detail.

The [v41 image-token calculator](2026-09-10-deepseek-image-token-calculator-v41.md) still owns pricing of whatever raster is sent.

## Alternatives considered

**Keep 640,000 and raise only Computer Use.** `imagePixelBudget` is a catalog-model field. The orb and ordinary vision sessions share `deepseek-flash`. A second model id would split the route without changing what the provider can see.

**Raise attachment `normalizedImageMaxPixels` with the request budget.** 2048×2048 (4,194,304) already exceeds 1,690,000, so the request projection remains the model-visible cap.

**Send the Retina capture unchanged.** The provider token-caps near 1300×1300. Larger files cost Files quota and request bytes without adding processed detail.

## Consequences

Each retained image that used the old 640,000-pixel default now costs more vision tokens (a 16:10 screenshot moves from roughly 400 toward the 1024 cap). Screenshot-heavy Computer Use sessions reach compaction sooner. `imagePixelBudget: 'low'` remains 512×512. Keyless `llm-replay` fixtures still declare `imageRequestTokens` and are unaffected.

## Testing

`packages/llm/llm-deepseek/tests/adapter.spec.ts` pins the omitted-model policy at 1,690,000 pixels. `request-pricing.spec.ts` pins a 1920×1080 source as 1733×975 / 968 tokens.
