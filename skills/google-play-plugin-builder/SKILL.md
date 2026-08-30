---
name: google-play-plugin-builder
description: Build, extend, audit, and test the Google Play Deployment Assistant MCP/ChatGPT app. Use for architecture, tool schemas, APIs, security, tests, policy-source integration, and release automation.
---
# Google Play Plugin Builder

## Mission
Maintain a production-quality Google Play deployment assistant. Preserve the two-mode architecture: public assistant for preparation and developer-owned connector for Play API account operations.

## Workflow
1. Read `MASTER_BUILD_PROMPT.md`, `docs/ARCHITECTURE.md`, and the existing tool catalog.
2. Verify any time-sensitive Google Play or OpenAI/MCP behavior from primary sources before changing contracts.
3. Inspect the codebase before adding tools; reuse common policy, auth, download, edit-transaction, validation, and audit utilities.
4. For new tools, assign an action class and document side effects.
5. Keep all Play API account operations behind owner mode, package allowlists, least privilege, and write gates.
6. Add tests before considering a capability complete.
7. Update documentation and policy snapshot dates/sources when rules change.

## Hard rules
- Never turn public mode into a third-party centralized Play publishing service.
- Never weaken production/write confirmations.
- Never log secrets.
- Never hard-code one package or developer.
- Never claim policy compliance based only on stale local rules.
- No browser DOM scraping of Play Console when an official API or user-provided evidence is available.
- Do not silently change metadata, policy declarations, or releases.

## Completion gate
Run typecheck, tests, security-policy tests, and any integration tests available. Report exactly what was tested and any unvalidated area.
