"""Universal Google Play Publisher MCP: per-user Google consent and verified apps.
Google tokens stay encrypted server-side; releases are approval-gated.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from functools import lru_cache
from urllib.parse import quote, urlsplit
from contextvars import ContextVar
from fastapi.responses import HTMLResponse, RedirectResponse
from google_oauth import connect_link, complete as finish_google_oauth, token_for, ready as google_oauth_ready, browser_login_url, identity_confirm
import universal_store as store

import httpx
import jwt
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from jwt import PyJWKClient

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
VERSION = "0.7.0"
PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
PACKAGE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$")


def canonical_url():
    """Canonical HTTPS origin; no path, userinfo, query or fragment."""
    base = os.environ.get("MCP_PUBLIC_URL", "").rstrip("/")
    parsed = urlsplit(base)
    return base if (parsed.scheme == "https" and parsed.netloc and not parsed.username
                    and not parsed.password and not parsed.path and not parsed.query
                    and not parsed.fragment) else None


def auth_ready():
    """Check external OAuth provider configuration independently from Play API access.

    Token issuance/login remains outside this app; this only enables OAuth discovery.
    """
    issuer_value = os.environ.get("AUTH_ISSUER", "")
    issuer = urlsplit(issuer_value)
    if not (issuer.scheme == "https" and issuer.netloc and not issuer.username
            and not issuer.password and not issuer.query and not issuer.fragment):
        return False
    return bool(canonical_url() and os.environ.get("AUTH_AUDIENCE") == canonical_url() + "/api/mcp")


def settings_ready():
    return (auth_ready() and google_oauth_ready() and store.ready()
            and len(os.environ.get("PLAY_APPROVAL_SIGNING_KEY", "")) >= 32)


def oauth_metadata():
    if not auth_ready():
        return None
    return {"resource": canonical_url() + "/api/mcp",
            "authorization_servers": [os.environ["AUTH_ISSUER"]],
            "scopes_supported": ["play:read", "play:write"]}


def package_id(value):
    if not isinstance(value, str) or len(value) > 200 or not PACKAGE.fullmatch(value):
        raise ValueError("Invalid Android package ID")
    return value


@lru_cache(maxsize=4)
def jwks(url):
    return PyJWKClient(url, cache_keys=True, lifespan=300)


def authenticate(request):
    issuer = os.environ["AUTH_ISSUER"]
    aud = os.environ["AUTH_AUDIENCE"]
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer ") or len(header) > 8192:
        raise PermissionError("Missing bearer token")
    token = header.removeprefix("Bearer ")
    key = jwks(issuer.rstrip("/") + "/.well-known/jwks.json").get_signing_key_from_jwt(token).key
    data = jwt.decode(token, key, algorithms=["RS256"], issuer=issuer,
                      audience=aud, leeway=20,
                      options={"require": ["sub", "iss", "aud", "exp", "iat"]})
    if not isinstance(data["sub"], str) or not data["sub"]:
        raise PermissionError("Invalid OAuth subject")
    return {"sub": data["sub"], "scopes": set(str(data.get("scope", "")).split())}


ACTIVE_GOOGLE_TOKEN = ContextVar("play_google_token", default=None)
ACTIVE_CONNECTION = ContextVar("play_google_connection", default=None)


def permitted(identity, pkg=None, permission="play:read"):
    if permission not in identity.get("scopes", set()):
        raise PermissionError("OAuth scope missing")
    if pkg is not None:
        cid = ACTIVE_CONNECTION.get()
        if not cid or not store.app_is_registered(identity["sub"], cid, pkg):
            raise PermissionError("App not verified under the selected Google connection")
    return store.apps(identity["sub"])


def use_google(identity, connection_id, pkg=None):
    if not isinstance(connection_id, str) or len(connection_id) > 80:
        raise PermissionError("Invalid Google connection")
    if not store.connection(identity["sub"], connection_id):
        raise PermissionError("Google connection does not belong to this user")
    if pkg is not None and not store.app_is_registered(identity["sub"], connection_id, pkg):
        raise PermissionError("App not verified for that Google connection")
    auth = token_for(identity["sub"], connection_id)
    ACTIVE_GOOGLE_TOKEN.set(auth)
    ACTIVE_CONNECTION.set(connection_id)


def google_token():
    token = ACTIVE_GOOGLE_TOKEN.get()
    if not token:
        raise PermissionError("A user-authorized Google connection is required")
    return token


def google_api(method, path, payload=None):
    token = google_token()
    with httpx.Client(timeout=45) as client:
        response = client.request(method, API_BASE + path,
                                  headers={"Authorization": "Bearer " + token,
                                           "Accept": "application/json"}, json=payload)
    if response.status_code >= 400:
        # Never leak raw API bodies, Google tokens or user information in errors.
        raise RuntimeError("Google Play API returned HTTP " + str(response.status_code))
    return response.json() if response.content else {}


def start_edit(pkg):
    result = google_api("POST", "/" + quote(pkg, safe="") + "/edits", {})
    if not result.get("id"):
        raise RuntimeError("Google Play edit not created")
    return str(result["id"])


def edit_path(pkg, eid):
    return "/" + quote(pkg, safe="") + "/edits/" + quote(eid, safe="")


def abandon(pkg, eid):
    try:
        google_api("DELETE", edit_path(pkg, eid))
    except Exception:
        pass


def list_tracks(pkg):
    eid = start_edit(pkg)
    try:
        return google_api("GET", edit_path(pkg, eid) + "/tracks").get("tracks", [])
    finally:
        abandon(pkg, eid)


def release_snapshot(pkg, track):
    """Fetch Play track and uploaded bundles in one read-only edit."""
    eid = start_edit(pkg)
    try:
        current_tracks = google_api("GET", edit_path(pkg, eid) + "/tracks").get("tracks", [])
        bundles = google_api("GET", edit_path(pkg, eid) + "/bundles").get("bundles", [])
        current = next((x for x in current_tracks if x.get("track") == track),
                       {"track": track, "releases": []})
        return current, bundles
    finally:
        abandon(pkg, eid)


def uploaded_bundle(bundles, code):
    """Only allow a versionCode for which Google confirms the uploaded bundle."""
    match = next((x for x in bundles if str(x.get("versionCode")) == str(code)), None)
    if not match or not re.fullmatch(r"[0-9a-fA-F]{64}", str(match.get("sha256", ""))):
        raise ValueError("The approved versionCode is not confirmed as an uploaded AAB")
    return match["sha256"].lower()


def digest(track):
    return hashlib.sha256(json.dumps(track, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def prepare_release(identity, pkg, track, code, notes):
    pkg = package_id(pkg)
    permitted(identity, pkg)
    if track not in ("qa", "beta") or type(code) is not int or code < 1:
        raise ValueError("Only internal and open testing tracks are supported")
    if not isinstance(notes, str) or not 1 <= len(notes) <= 500:
        raise ValueError("Release notes length must be between 1 and 500 characters")
    current, bundles = release_snapshot(pkg, track)
    bundle_hash = uploaded_bundle(bundles, code)
    if any(x.get("status") in ("inProgress", "halted") for x in current.get("releases", [])):
        raise ValueError("A staged or halted release already exists")
    if any(str(code) in list(map(str, x.get("versionCodes", []))) for x in current.get("releases", [])):
        raise ValueError("Version already present on track")
    signing = os.environ["PLAY_APPROVAL_SIGNING_KEY"]
    if len(signing) < 32:
        raise ValueError("Server approval secret is too short")
    issued = int(time.time())
    plan = {"iss": "private-play-publisher", "aud": "play-approval", "sub": identity["sub"],
            "package": pkg, "track": track, "version_code": code, "notes": notes,
            "track_sha256": digest(current), "bundle_sha256": bundle_hash, "connection_id": ACTIVE_CONNECTION.get(),
            "jti": hashlib.sha256(os.urandom(32)).hexdigest(),
            "iat": issued, "exp": issued + 600}
    store.add_plan(identity["sub"], ACTIVE_CONNECTION.get(), pkg, plan["jti"], issued + 600)
    return {"applied": False, "package": pkg, "track": track,
            "version_code": code, "release_notes": notes, "bundle_sha256": bundle_hash,
            "approval_token": jwt.encode(plan, signing, algorithm="HS256"),
            "confirmation": "PUBLISH " + pkg + ":" + track + ":" + str(code),
            "expires_in_seconds": 600,
            "note": "Bundle must be uploaded separately first; this tool assigns an existing versionCode"}


def commit_release(identity, token, confirmation):
    if os.environ.get("PLAY_ENABLE_TEST_WRITES") != "YES":
        raise PermissionError("Testing writes disabled")
    plan = jwt.decode(token, os.environ["PLAY_APPROVAL_SIGNING_KEY"],
                      algorithms=["HS256"], issuer="private-play-publisher",
                      audience="play-approval", options={"require": ["sub", "iat", "exp"]})
    if identity["sub"] != plan["sub"]:
        raise PermissionError("Release approval belongs to a different user")
    pkg = package_id(plan["package"])
    if plan.get("connection_id") != ACTIVE_CONNECTION.get():
        raise PermissionError("Release plan belongs to a different Google connection")
    permitted(identity, pkg, "play:write")
    track, code = plan["track"], plan["version_code"]
    if track not in ("qa", "beta") or type(code) is not int:
        raise PermissionError("Production writes are not available through this server")
    if confirmation != "PUBLISH " + pkg + ":" + track + ":" + str(code):
        raise ValueError("Exact release confirmation mismatch")
    if not store.claim_plan(identity["sub"], ACTIVE_CONNECTION.get(), pkg, plan.get("jti", ""), int(time.time())):
        raise PermissionError("Approval was used, revoked or expired")
    eid = start_edit(pkg)
    try:
        tracks_now = google_api("GET", edit_path(pkg, eid) + "/tracks").get("tracks", [])
        current = next((x for x in tracks_now if x.get("track") == track),
                       {"track": track, "releases": []})
        bundles_now = google_api("GET", edit_path(pkg, eid) + "/bundles").get("bundles", [])
        if uploaded_bundle(bundles_now, code) != plan.get("bundle_sha256"):
            raise ValueError("Uploaded AAB has changed since release planning")
        if digest(current) != plan["track_sha256"]:
            raise ValueError("Track changed since the plan was created")
        if any(str(code) in list(map(str, x.get("versionCodes", []))) for x in current.get("releases", [])):
            raise ValueError("Version already present")
        release = {"status": "completed", "versionCodes": [str(code)],
                   "releaseNotes": [{"language": "en-US", "text": plan["notes"]}]}
        google_api("PUT", edit_path(pkg, eid) + "/tracks/" + quote(track, safe=""),
                   {"track": track, "releases": [release]})
        google_api("POST", edit_path(pkg, eid) + ":validate", {})
        result = google_api("POST", edit_path(pkg, eid) + ":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW", {})
        return {"committed": True, "package": pkg, "track": track, "version_code": code,
                "edit_id": result.get("id"), "note": "Play review and tester availability are separate steps"}
    finally:
        abandon(pkg, eid)


def schema(name, description, properties=None, required=None, write=False):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties or {},
                            "required": required or [], "additionalProperties": False},
            "annotations": {"readOnlyHint": not write, "openWorldHint": True,
                            "destructiveHint": False},
            "securitySchemes": [{"type": "oauth2", "scopes": ["play:write" if write else "play:read"]}]}

TOOLS = [
    schema("play_connection_status", "List the authenticated user's own Google accounts and verified Play apps."),
    schema("play_start_google_connection", "Generate an official Google OAuth consent URL for the signed-in user. Consent occurs in their browser."),
    schema("play_list_google_connections", "List my Google Play connections without revealing refresh tokens."),
    schema("play_register_app", "Verify an app is accessible through this Google account, then register it under this user.",
           {"connection_id": {"type": "string"}, "package": {"type": "string"}}, ["connection_id", "package"]),
    schema("play_list_apps", "List apps verified for the current user across connected Google accounts."),
    schema("play_disconnect_google", "Disconnect my Google account and remove stored credentials and apps.",
           {"connection_id": {"type": "string"}, "confirmation": {"type": "string"}},
           ["connection_id", "confirmation"], write=True),
    schema("play_inspect_tracks", "Read live release tracks for a verified app on the chosen Google account.",
           {"connection_id": {"type": "string"}, "package": {"type": "string"}},
           ["connection_id", "package"]),
    schema("play_plan_testing_release", "Prepare a signed 10-minute testing release plan for a pre-uploaded AAB.",
           {"connection_id": {"type": "string"}, "package": {"type": "string"},
            "track": {"type": "string", "enum": ["qa", "beta"]},
            "version_code": {"type": "integer", "minimum": 1},
            "release_notes": {"type": "string", "maxLength": 500}},
           ["connection_id", "package", "track", "version_code", "release_notes"]),
    schema("play_commit_testing_release", "Commit a one-use, explicit approval to internal/open testing only; production disabled.",
           {"connection_id": {"type": "string"}, "approval_token": {"type": "string"},
            "confirmation": {"type": "string"}},
           ["connection_id", "approval_token", "confirmation"], write=True),
]


def result(data, request_id):
    return {"jsonrpc": "2.0", "id": request_id,
            "result": {"content": [{"type": "text", "text": json.dumps(data)}],
                       "structuredContent": data}}


def failure(code, message, request_id, status=400):
    return JSONResponse({"jsonrpc": "2.0", "id": request_id,
                         "error": {"code": code, "message": message}}, status_code=status)


def authorization_challenge():
    location = (canonical_url() or "https://example.invalid") + "/.well-known/oauth-protected-resource"
    header = (f'Bearer resource_metadata="{location}", '
              'error="invalid_token", error_description="Google Play authorization required"')
    return JSONResponse({"error": "authentication_required"}, status_code=401,
                        headers={"WWW-Authenticate": header})


def tool_authorization_required(request_id):
    """Emit the MCP tool-level OAuth challenge expected by ChatGPT clients."""
    location = ((canonical_url() or "https://example.invalid") +
                "/.well-known/oauth-protected-resource")
    bearer = (f'Bearer resource_metadata="{location}", error="invalid_token", '
              'error_description="Connect an authorized Google Play account"')
    return {"jsonrpc": "2.0", "id": request_id, "result": {
        "content": [{"type": "text", "text": "Google Play authorization is required."}],
        "isError": True, "_meta": {"mcp/www_authenticate": [bearer]}}}


@app.get("/")
def root():
    return {"service": "Google Play Private Publisher MCP", "version": VERSION,
            "mode": "authentication-required", "health": "/api/health"}


@app.get("/api/health")
def health():
    return {"version": VERSION, "configured": settings_ready(),
            "oauth_provider_configured": auth_ready(),
            "google_oauth_client_configured": google_oauth_ready(),
            "persistent_encrypted_store_configured": store.ready(),
            "per_user_google_connections": True,
            "static_package_allowlist_required": False,
            "testing_writes_enabled": settings_ready() and os.environ.get("PLAY_ENABLE_TEST_WRITES") == "YES",
            "production_writes_enabled": False}


@app.get("/oauth/browser/start")
def browser_start(state: str = ""):
    if not settings_ready():
        return HTMLResponse("Publishing authorization is not configured.",status_code=503)
    try:
        url=browser_login_url(state)
    except Exception:
        return HTMLResponse("Invalid or expired account-link link.",status_code=400)
    return RedirectResponse(url,status_code=302)


@app.get("/oauth/browser/identity-callback")
def browser_identity_callback(state: str = "", code: str = "", error: str = ""):
    if error: return HTMLResponse("Identity authorization was cancelled.",status_code=400)
    try:
        url,cookie=identity_confirm(state,code)
    except Exception:
        return HTMLResponse("Auth0 browser identity did not match the account that requested this link.",status_code=403)
    response=RedirectResponse(url,status_code=302)
    response.set_cookie("play_link_session",cookie,httponly=True,secure=True,samesite="lax",
                        path="/oauth/google/callback",max_age=600)
    return response


@app.get("/oauth/google/callback")
def google_callback(request: Request, state: str = "", code: str = "", error: str = ""):
    if error:
        return HTMLResponse("Google authorization was cancelled. Return to the publisher.", status_code=400)
    if not settings_ready():
        return HTMLResponse("Publisher account connections are not configured.", status_code=503)
    try:
        result = finish_google_oauth(state, code, request.cookies.get("play_link_session", ""))
    except Exception:
        return HTMLResponse("Google connection failed or expired. Return to the publisher and retry.", status_code=400)
    response = HTMLResponse("<h2>Google Play account connected</h2><p>Return to ChatGPT or Pamtech Publisher and list your Google connections. No app was published.</p>")
    response.delete_cookie("play_link_session",path="/oauth/google/callback")
    return response


@app.get("/.well-known/oauth-protected-resource")
def metadata():
    value = oauth_metadata()
    return value if value else JSONResponse({"error": "OAuth not configured"}, status_code=503)


@app.get("/api/mcp")
def get_mcp():
    if not auth_ready():
        return JSONResponse({"error": "OAuth provider not configured"}, status_code=503)
    return authorization_challenge()



from mcp_routes import install as install_mcp
install_mcp(app, globals())
