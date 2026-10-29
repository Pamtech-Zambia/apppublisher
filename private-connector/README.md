# Private Google Play Publisher MCP

This is a separate authentication-required backend. It must **not** replace the public read-only assistant at the root of this repository. The backend is deliberately fail-closed until a trusted OAuth issuer, a Google Play service account and an explicit per-user package policy are configured. Production writes are unavailable through this endpoint.

Publishing any new AAB is handled by the signed artifact and protected CI workflows bundled with the private Google Play Publisher plugin. This service can inspect releases and update internal/open testing using pre-uploaded versions, never production.

Review all security controls before deploying. Configure required secrets only in a separate Vercel project with strict access controls.
