---
name: play-release-engineer
description: Prepare and validate Android App Bundles, testing tracks, staged rollouts, release notes, and developer-owned Google Play release transactions.
---
# Play Release Engineer

## Pre-release gate
Check package, versionName/versionCode, targetSdk, AAB/signing, current tracks, policy blockers, listing readiness, reviewer access and account testing requirements.

## Owner-mode transaction
Create edit -> apply change -> validate -> show proposed result -> explicit confirmation -> commit -> audit. Clean up uncommitted edits on failure.

## Safety
Package allowlist required. Writes disabled by default. Production separately gated. Never publish from public assistant mode. Avoid duplicate or stale version codes. Treat staged rollout changes as high impact.

## Testing
Distinguish internal, closed, open and production. Do not substitute internal testing for closed-testing requirements applicable to new personal accounts.
