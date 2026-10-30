# Pamtech Universal Google Play Publisher — private MCP backend v0.7

Per-user Auth0 + Google OAuth; encrypted persistent Google tokens and explicit, verified app registration. No shared developer service-account, no static package allowlist. User-controlled app registration works for **any package the connected Google Play account is permitted to access**. The testing release tool operates only on version codes already uploaded to Play. Production release is disabled.

All account-linking operations refuse to work until a managed database, Auth0 OAuth provider and web client, Google OAuth web client, encryption key and signing key are configured. See `SETUP.md`.

## Development

Install dependencies from `requirements.txt`; create the PostgreSQL schema using `schema.sql`. For local unit tests, the tests intentionally use a disposable SQLite database behind a test-only code path. Production always requires PostgreSQL.

`python -m pytest -q tests/test_universal.py`

Vercel: Deploy from this directory as **FastAPI**, not the read-only public analysis site. `app.py` exposes the FastAPI application. Limit `AUTH0_WEB_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`, `DATABASE_URL`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, and `PLAY_APPROVAL_SIGNING_KEY` to encrypted Production settings. Use `PLAY_ENABLE_TEST_WRITES=NO` during onboarding.

Server: `https://pamtech-play-private-connector.vercel.app/api/mcp`
Google callback: `https://pamtech-play-private-connector.vercel.app/oauth/google/callback`
Auth0 browser callback: `https://pamtech-play-private-connector.vercel.app/oauth/browser/identity-callback`

Readiness without a configured provider/database is **not** the same as a deployment build passing. This build does not connect to any Google account until the administrator completes setup.
