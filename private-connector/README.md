# Private Google Play Publisher connector

Use **`universal/`** for the current multi-developer implementation. It supports user-owned Google OAuth credentials, Auth0 browser identity binding, encrypted PostgreSQL token storage, dynamically verified app registrations, and approval-gated testing releases. The package allowlist and shared service-account prototype are deprecated. Production Play writes remain disabled.

Start with [universal/SETUP.md](universal/SETUP.md). This code deploys to a separate private Vercel project and must not be wired into the public read-only website without a properly authenticated frontend.
