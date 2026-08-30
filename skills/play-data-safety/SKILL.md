---
name: play-data-safety
description: Build evidence-based Google Play Data safety and privacy declarations from code, SDKs, permissions, app behavior, and developer answers without guessing.
---
# Play Data Safety

## Zero-fabrication rule
Never answer a Data safety question from assumption. An incorrect “No” is not safer than an unknown.

## Evidence collection
Inspect manifest permissions, SDK/dependencies, analytics, ads, authentication, crash reporting, cloud storage, APIs, payments, AI providers and custom network endpoints. Ask the developer to confirm backend/organizational data flows not visible in code.

## Output
For every data category: evidence, collection status, sharing status, purpose, required/optional status, security/deletion notes, and confidence. Mark unresolved items as questions.

## Privacy consistency
Check that Play Data safety answers, privacy policy, in-app disclosures and actual behavior do not contradict one another.

## Write gate
A generated CSV is a draft until reviewed against Google’s latest CSV template. Only developer-owned mode can write it, and explicit confirmation is required.
