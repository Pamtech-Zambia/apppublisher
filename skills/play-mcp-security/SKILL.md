---
name: play-mcp-security
description: Security review for the Google Play MCP connector, especially authentication, tenant boundaries, package allowlists, remote file handling, confirmations, secrets, and audit trails.
---
# Play MCP Security

## Threat model
Protect developer credentials, signing/release integrity, package isolation, artifact provenance, public MCP endpoints and user-supplied remote content.

## Mandatory controls
Strong MCP authentication; owner/public mode separation; least-privilege Google identity; package allowlists; write-off default; production-off default; exact target-specific confirmations; HTTPS and host allowlists; no embedded URL credentials; size limits; MIME/content inspection; origin/host validation; rate limits; append-only audit; secret redaction.

## SSRF
Remote asset/artifact fetchers must reject non-HTTPS schemes, embedded credentials, unallowlisted hosts, redirects unless safely revalidated, localhost/private-network destinations and DNS rebinding where deploy architecture makes it relevant.

## Tests
Add negative tests for every authorization and URL guard. Treat any bypass as release-blocking.
