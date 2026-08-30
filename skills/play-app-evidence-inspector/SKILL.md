---
name: play-app-evidence-inspector
description: Inspect Android repositories, APKs and AABs to derive Play deployment facts, generate evidence-backed suggestions, and block unsupported or contradicted store/policy claims.
---
# Play App Evidence Inspector

## Use when
A repository, source archive, APK or AAB is available, or when the user asks the assistant to prepare an app for Google Play with minimal manual questioning.

## Primary rule
**Inspect first. Suggest second. Ask only for unresolved facts. Never invent.**

## Repository inspection
Where present, inspect Gradle/module configuration, manifests, permissions, components, deep links, network configuration, dependencies/SDKs, resources, icons, strings, account flows, data-related integrations, billing, ads, analytics, authentication, location/camera/microphone/storage usage, AI/cloud providers, and feature flags.

Redact secrets. Never surface tokens, passwords, private keys, signing material or confidential credentials.

## APK/AAB inspection
Use available Android tooling (`bundletool`, `apkanalyzer`, `aapt2`, signing certificate inspection, ZIP/resource inspection) to derive package ID, versions, SDK levels, permissions/features/components, modules/splits, ABIs, resources and other relevant build facts. Treat APK analysis as diagnostic unless current Google requirements confirm it is an accepted publication artifact for the intended submission.

## Evidence classes
Use:
- `COMPILED_EVIDENCE`
- `SOURCE_EVIDENCE`
- `RUNTIME_EVIDENCE`
- `PLAY_STATE_EVIDENCE`
- `DEVELOPER_CONFIRMED`
- `INFERRED`
- `UNKNOWN`

Never use `INFERRED` alone for Data safety, audience, ownership, affiliation, sensitive-permission justification, health/financial status, reviewer access or similar high-impact declarations.

## Suggestion output
Produce:
1. `BLOCKING`
2. `REQUIRED_INPUT`
3. `STRONG_RECOMMENDATION`
4. `OPTIONAL_IMPROVEMENT`

Each suggestion includes evidence, confidence, fixability, approval requirement and policy-freshness requirement.

Proactively suggest listing copy, likely category/tags, screenshot capture plan, icon/feature-graphic work, permissions cleanup, privacy/Data safety questions, reviewer access, target SDK/build fixes, testing needs and contradictions.

## Claim ledger
Every material proposed claim must be registered as:
`VERIFIED | DEVELOPER_CONFIRMED | UNVERIFIED | CONTRADICTED | PROHIBITED`.

Only verified or legitimately developer-confirmed claims can appear in publishable listing/declaration outputs.

## Zero-tolerance truthfulness
Never:
- invent features;
- fake screenshots;
- make false privacy/security claims;
- falsify Data safety or policy declarations;
- claim nonexistent affiliations/licences/approvals;
- conceal policy-sensitive behavior from reviewers;
- change behavior to evade review;
- rewrite metadata to hide a known violation while leaving the violating app behavior unchanged.

If the user requests deception, refuse that portion and recommend a truthful app, metadata or declaration correction.

## Google rejection parity
When current official Google policy clearly rejects an observed condition, mark it `BLOCKING` and do not consider the release ready. For judgment-dependent cases, use `REVIEW_RISK`; never pretend to reproduce Google's proprietary review decision.
