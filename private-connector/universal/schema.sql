-- Run once in a private, managed PostgreSQL database. No public grants / browser access.
CREATE TABLE IF NOT EXISTS play_oauth_intents (
  state_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  browser_cookie_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS play_oauth_intents_expires_idx ON play_oauth_intents (expires_at);

CREATE TABLE IF NOT EXISTS play_google_connections (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  google_email TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(subject,google_sub)
);
CREATE INDEX IF NOT EXISTS play_google_connections_sub_idx ON play_google_connections (subject);

CREATE TABLE IF NOT EXISTS play_registered_apps (
  subject TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES play_google_connections(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  PRIMARY KEY(subject,connection_id,package_name)
);
CREATE TABLE IF NOT EXISTS play_release_plans (
  jti TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES play_google_connections(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS play_release_plans_expires_idx ON play_release_plans (expires_at);

-- Grant SQL privileges exclusively to the backend database role.
-- Rotate GOOGLE_TOKEN_ENCRYPTION_KEY using a staged migration; losing it destroys token access.

-- Browser identity must match the Auth0 subject that initiated account connection.
CREATE TABLE IF NOT EXISTS play_browser_intents (
  state_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  google_verifier_cipher TEXT NOT NULL,
  auth0_verifier_cipher TEXT NOT NULL,
  oidc_nonce TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS play_browser_intents_expires_idx ON play_browser_intents(expires_at);
