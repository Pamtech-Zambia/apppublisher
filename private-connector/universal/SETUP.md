# Universal Google Play Publisher v0.7 — secure deployment and remaining owner steps

This version **does not require `PLAY_SUBJECT_PACKAGES_JSON`**. The backend is a per-developer OAuth resource server. Each ChatGPT/website user signs in through Auth0, reauthenticates in the browser for account linking, and explicitly connects one or more Google accounts. The system stores encrypted per-user Google refresh tokens in a private Postgres database. The user can then enter a package name (from a verified APK/AAB/source manifest) and must prove that Google Play allows that account to view the app. Every other app remains unregistered and inaccessible. **There is no general Play API method for enumerating all account apps.**

## Owner configuration: Auth0

1. In Auth0 tenant create an **API** with identifier `https://pamtech-play-private-connector.vercel.app/api/mcp`, RS256 JWT access tokens, and scopes `play:read` and `play:write`. Configure RBAC and ChatGPT MCP OAuth support (resource parameter, PKCE S256, supported client metadata/registration).
2. In the SAME tenant create a **Regular Web Application** named `Pamtech Publisher Browser Identity`. Set allowed callback URL **exactly** `https://pamtech-play-private-connector.vercel.app/oauth/browser/identity-callback`. Enable Authorization Code and PKCE; use server-side client credentials. The browser identity step issues an `openid` ID token and must validate the same user `sub` as the MCP access token.
3. Copy the exact Auth0 issuer from `https://YOUR-AUTH0-DOMAIN/.well-known/openid-configuration` (including trailing slash) into `AUTH_ISSUER`. Set `AUTH0_WEB_CLIENT_ID` and `AUTH0_WEB_CLIENT_SECRET` in Vercel **Production only**. Register only approved ChatGPT clients. Do not post any client secrets in chat.
4. Confirm an authenticated ChatGPT MCP read operation grants only the scopes intended for the user.

## Owner configuration: Google Cloud

1. Select a Google Cloud project owned by Pamtech. Enable the **Google Play Android Developer API** (androidpublisher.googleapis.com). For developer-delegated OAuth, do NOT require a central service account to be invited to every developer's Play Console.
2. Configure **Google Auth Platform / OAuth consent screen** with actual app name, support email, privacy policy/terms, authorized production domain, developer contact and verification as required by Google for the `https://www.googleapis.com/auth/androidpublisher` scope. In Testing status, only listed test users can consent; refresh token lifetimes may be shortened. For external production use, complete Google's requested verification and publish the consent configuration.
3. Create **OAuth Client ID → Web application** with authorized redirect URI **exactly** `https://pamtech-play-private-connector.vercel.app/oauth/google/callback`. Save client ID as `GOOGLE_OAUTH_CLIENT_ID` and client secret as `GOOGLE_OAUTH_CLIENT_SECRET` in secure Vercel Production variables.
4. Each developer signs in with a Google account that already has app permissions granted in their own Play Console. The consent screen requests `openid email` plus `https://www.googleapis.com/auth/androidpublisher`, using PKCE S256, one-time state, verified browser session and offline access.

## Owner configuration: Google Play Console

1. Each developer logs in to their own Play Console and grants their **Google user** the necessary permissions under Users and permissions. For basic access: View app information (read-only). For internal/open testing: Release apps to testing tracks. Do not grant production access if unnecessary. Developer's role and eligibility are enforced by Google Play itself.
2. An app must already exist in Play Console before its Play API release state can be inspected. The plugin detects the actual package ID from uploaded app or repo, then the signed-in user explicitly registers and verifies it using that Google connection. The server does not grant arbitrary guessed package access.
3. Production release is NOT exposed via this MCP. A separate, protected, reviewer-approved workflow is required.

## Owner configuration: Vercel / Database

1. Create a **private managed PostgreSQL** database (Neon or another serverless Postgres) and attach it to the separate Vercel project `pamtech-play-private-connector`. Check the plan/cost before provisioning. Avoid publicly exposed tables, anonymous DB keys and database connections without TLS.
2. Apply `schema.sql` once using the DB provider's protected SQL editor or migration tooling. This creates `play_google_connections`, `play_registered_apps`, `play_oauth_intents`, `play_browser_intents` and `play_release_plans`.
3. Set `DATABASE_URL` in secure Vercel Production environment variables. For access from Vercel Functions, use your provider's serverless-compatible connection string with appropriate TLS.
4. Generate two independent, strong secrets using a trusted local terminal:
   - `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` → `GOOGLE_TOKEN_ENCRYPTION_KEY`
   - `python -c "import secrets; print(secrets.token_urlsafe(48))"` → `PLAY_APPROVAL_SIGNING_KEY`
   Enter them ONLY into encrypted/sensitive Vercel Production env vars. Store backups securely; losing the Fernet key makes persisted refresh tokens undecryptable.
5. Keep existing `MCP_PUBLIC_URL` and `AUTH_AUDIENCE` values. Set `PLAY_ENABLE_TEST_WRITES=NO`. The old `PLAY_SUBJECT_PACKAGES_JSON` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` are **obsolete**, and can be removed only after the v0.7 deployment is READY. Neither is used by v0.7.
6. Redeploy after setting environment variables. `GET /api/health` must show `configured:true` and `testing_writes_enabled:false`. This does NOT mean a real Google user has connected; continue with live checks.
7. Test an authenticated user: `play_start_google_connection` → click URL → Auth0 browser re-auth (same user) → Google consent → Google callback success → `play_list_google_connections` → `play_register_app` using the app's actual package ID → `play_inspect_tracks`.
8. Verify negative tests: an unrelated Auth0 user cannot see the connection or app; a Google account without Play Console permissions cannot register it; a link opened by another Auth0 user fails; invalid/expired/replayed states fail; no production tool is available. Only then evaluate enabling testing writes with explicit approval.

## Important remaining limitations

- No live account was connected automatically; owner credentials and private DB must be configured in their respective consoles.
- OAuth scopes authorize API access for the connected user, not automatically every app. Google Play permissions are evaluated on each application request.
- APK/AAB uploads are still handled by protected build/artifact flows, not by this MCP endpoint. Publishing an already uploaded versionCode to testing is supported after the approval gate and real Google authorization.
- Durable audit logs and rate limiting should be added before broad public usage; no production release tool in this private endpoint. Use a separate environment to validate live Google OAuth before public rollout.
- The public app-analysis website remains read-only. Connecting its sign-in and user dashboard to this resource server requires a compatible frontend OAuth session (not a public service token).

Official references:
- https://developers.google.com/android-publisher/getting_started
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.openai.com/plugins/build/auth
- https://auth0.com/docs
