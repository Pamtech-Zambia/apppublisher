---
name: play-policy-compliance
description: Audit an Android app against current Google Play requirements and developer policies, using live primary sources for policy-sensitive conclusions.
---
# Play Policy Compliance

## Use when
The user asks whether an app is ready, compliant, rejected, blocked, missing declarations, or affected by policy deadlines.

## Method
1. Determine date and app form factor.
2. Fetch current official Google Play/Android policy sources for material rules.
3. Inspect available app evidence: manifest, targetSdk, dependencies, permissions, listing, privacy policy, declarations, screenshots, account type and rejection notices.
4. Produce four buckets: `BLOCKER`, `REQUIRED-UNKNOWN`, `WARNING`, `READY`.
5. Every blocker must name the evidence and the current rule/source.
6. Never infer data collection, target audience, health/financial features, or reviewer access credentials.
7. Re-run after fixes.

## Special attention
Target API, developer verification, personal-account testing, Data safety, privacy policy, ads, target audience, content rating, health, financial features, AI integrations, sensitive permissions, UGC, children, impersonation/IP, metadata, app access, deceptive behavior, malicious behavior, billing/financial services where relevant.

## Output
A concise readiness summary plus a machine-readable checklist suitable for `play_readiness_check` or future UI rendering.
