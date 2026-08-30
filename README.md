# Google Play Deployment Assistant

Evidence-first MCP/ChatGPT app for preparing Android apps for Google Play.

## Core rule

**Inspect first. Suggest second. Ask only for unresolved facts. Never invent app behavior, declarations, affiliations, privacy claims, screenshots, or store-listing claims.**

The public deployment is intentionally read/preparation oriented. Google Play write/publish operations must remain in a separate developer-owned deployment that uses that developer's own credentials and package allowlist.

## Current test release

Version: `0.5.1-test`

Current public MCP tools:

- `play_connector_status`
- `play_store_listing_validate`
- `play_claims_evaluate`
- `play_inspection_suggestions`
- `play_app_evidence_summary`

## Local development

```bash
npm install
npm run build
npm run dev
```

Node.js 22 is expected.

## Vercel

This repository is ready to import into Vercel as a Next.js project.

After deployment:

- MCP endpoint: `https://YOUR-DOMAIN/api/mcp`
- Health endpoint: `https://YOUR-DOMAIN/api/health`

Do not enable Play Console write actions in the public deployment.

## Truthfulness gate

Claims are classified as verified, developer-confirmed, unverified, contradicted, or prohibited. Unsupported, contradicted, and prohibited claims must not be converted into publishable Play Store metadata.

## Security

Never commit service-account credentials, OAuth refresh tokens, keystores, signing passwords, Play Console credentials, or API secrets to this repository.
