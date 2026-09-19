# Agent Note: Canonical-repository skip for org-only GitHub Actions

Status: implemented

English | [中文](2026-09-19-canonical-repository-org-only-workflows.zh.md)

## Problem

Four workflows consume organization credentials that exist only on `deepseek-harness/deepseek-harness`: Cloudflare Pages preview tokens, the Issue GitHub App that mutates the org Project, and the real-API e2e secret. GitHub's `pull_request.head.repo.fork` flag is false for a same-repository PR on an independent copy (a renamed clone that is not a GitHub fork). Those copies therefore run the jobs, fail on empty `client-id` / missing Cloudflare tokens / setup that assumes the org, send a failure email per workflow per push, and consume Actions minutes.

## Decision

The preview, Issue policy, Issue lifecycle, and real-API e2e jobs run only when `github.repository == 'deepseek-harness/deepseek-harness'`. That is the same repository identity [release pack jobs](../../../../.github/workflows/release.yml) already use to select self-hosted runners. A job-level `if:` skip reports as a successful check, so copies do not fail required statuses or emit failure mail.

Issue lifecycle has no event-type skip inside the canonical repository: every `pull_request_review` event lists the check as success rather than a gray skipped segment; token minting and board mutation stay step-gated to `changes_requested`.

Real-API e2e keeps the existing untrusted-PR conjunct after the repository test, so fork and Dependabot PRs into the canonical repository still skip. The [real-API e2e decision](../testing/2026-06-19-real-api-e2e-ci.md) remains the authority for secret exposure, `pull_request` vs `pull_request_target`, and the missing-secret preflight. This note owns only which repository may run org-credential workflows.

## Alternatives considered

**Skip when the required secret or variable is empty.** An empty `CLOUDFLARE_API_TOKEN` or `DSH_ISSUE_APP_CLIENT_ID` on a copy would skip, but the same empty value on the canonical repository would also skip. Real-API e2e already rejects that: a missing secret must fail loud so the self-skipping suite cannot report a false green.

**Rely on `head.repo.fork`.** That flag is true only when GitHub records the head repository as a fork. Independent copies and same-repo PRs on those copies are not forks, so the existing e2e skip does not apply to them, and preview / Issue jobs never had that skip.

**Disable the workflows in the GitHub UI or delete the files on a copy.** UI disablement is not in the tree and is overwritten by whatever the next push of `.github/workflows/` contains. Deleting files on a copy fights every merge from upstream.

**Gate only `pull_request` and leave `push`/`schedule` running.** Copies still fail e2e on master pushes and the nightly schedule, which is the other failure-mail source.

## Consequences

Independent copies skip these four jobs on every trigger, including master push and schedule. They do not publish Cloudflare previews, do not move the org Project board, and do not run billed real-API e2e. Canonical-repository behavior is otherwise unchanged; e2e includes the repository identity in its `if:` in addition to the untrusted-PR conjunct.

Operators who want those jobs on a copy must either use the canonical repository or change this identity test; adding only the secret is not enough.

## Verification

[Preview workflow regressions](../../../../scripts/preview-workflow.spec.ts) pin the preview job's repository `if:`. [CI workflow regressions](../../../../scripts/ci-workflow.spec.ts) pin the e2e, Issue policy, and Issue lifecycle `if:` values and keep Issue lifecycle free of event-type job skips.
