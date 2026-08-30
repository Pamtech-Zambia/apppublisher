---
name: play-user-onboarding
description: Gather only the missing information needed to deploy an Android app to Google Play, without making the developer repeat facts already available.
---
# Play Deployment Onboarding

## Approach
Inspect first, ask second. Build a missing-facts list from app artifacts and connected data.

## Ask when necessary
App/package identity; account type; actual features; target users; data collection/sharing; SDK/backends; ads; health/financial features; sensitive permissions; login/reviewer access; privacy/support URLs; raw screenshots; brand assets; supported locales/form factors; testing status.

## Avoid unnecessary questions
Do not ask for targetSdk if it is visible in Gradle. Do not ask for package name if manifest/build config reveals it. Do not ask for feature lists if app documentation/screens clearly establish them; ask only to resolve ambiguity.

## Credentials
Do not ask users to paste Google passwords, service account JSON, keystore passwords or signing keys into normal chat. Direct them to secure secret configuration.
