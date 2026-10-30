"""MCP request dispatch. References are resolved against the private app module."""
from fastapi import Request
from fastapi.responses import JSONResponse
import jwt

def install(app, ns):
    @app.post("/api/mcp")
    async def mcp(request: Request):
        if not ns["auth_ready"]():
            return JSONResponse({"error": "OAuth provider not configured"}, status_code=503)
        try:
            message = await request.json()
        except Exception:
            return ns["failure"](-32700, "Invalid JSON", None)
        if not isinstance(message, dict):
            return ns["failure"](-32600, "Invalid MCP message", None)
        method, request_id, params = message.get("method"), message.get("id"), message.get("params") or {}
        if method == "notifications/initialized":
            return JSONResponse({}, status_code=202)
        if method == "initialize":
            return {"jsonrpc": "2.0", "id": request_id,
                    "result": {"protocolVersion": "2025-06-18",
                               "capabilities": {"tools": {"listChanged": False}},
                               "serverInfo": {"name": "universal-google-play-publisher", "version": VERSION}}}
        if method == "ping":
            return {"jsonrpc": "2.0", "id": request_id, "result": {}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": ns["TOOLS"]}}
        if method != "tools/call":
            return ns["failure"](-32601, "Unknown MCP method", request_id)
        if not ns["settings_ready"]():
            return ns["failure"](-32001, "Publisher account authorization is not configured", request_id, 503)
        try:
            identity = ns["authenticate"](request)
        except Exception:
            return ns["tool_authorization_required"](request_id)
        try:
            name, args = params.get("name"), params.get("arguments") or {}
            if not isinstance(args, dict):
                raise ValueError("Invalid tool arguments")
            if name in ("play_connection_status", "play_list_google_connections", "play_list_apps", "play_start_google_connection"):
                if "play:read" not in identity["scopes"]:
                    raise PermissionError("play:read scope required")
                if name == "play_start_google_connection":
                    output = {"authorization_url": ns["connect_link"](identity["sub"]),
                              "action": "Open URL in your browser, approve Google's consent request, then list connections."}
                elif name == "play_list_google_connections":
                    output = {"connections": ns["store"].connections(identity["sub"])}
                elif name == "play_list_apps":
                    output = {"apps": ns["store"].apps(identity["sub"])}
                else:
                    output = {"connections": ns["store"].connections(identity["sub"]),
                              "apps": ns["store"].apps(identity["sub"]),
                              "production_writes_enabled": False}
            elif name == "play_disconnect_google":
                cid = args.get("connection_id")
                if args.get("confirmation") != "DISCONNECT " + str(cid):
                    raise ValueError("Exact disconnect confirmation required")
                if "play:write" not in identity["scopes"]:
                    raise PermissionError("play:write scope required")
                if not ns["store"].connection(identity["sub"], cid):
                    raise PermissionError("Google account not owned by this user")
                ns["store"].disconnect(identity["sub"], cid)
                output = {"disconnected": True, "note": "Tokens deleted locally; user may revoke app access in Google Account settings."}
            elif name == "play_register_app":
                pkg = ns["package_id"](args.get("package"))
                if "play:read" not in identity["scopes"]:
                    raise PermissionError("play:read scope required")
                ns["use_google"](identity, args.get("connection_id"))
                _ = ns["list_tracks"](pkg)  # Real Google Play API proof; unknown packages never enter DB.
                ns["store"].register_app(identity["sub"], args["connection_id"], pkg)
                output = {"verified": True, "package": pkg, "connection_id": args["connection_id"],
                          "note": "Read access verified; Google Play separately enforces testing and production permissions."}
            elif name == "play_inspect_tracks":
                pkg = ns["package_id"](args.get("package"))
                ns["permitted"](identity, permission="play:read")
                ns["use_google"](identity, args.get("connection_id"), pkg)
                output = {"package": pkg, "tracks": ns["list_tracks"](pkg)}
            elif name == "play_plan_testing_release":
                pkg = ns["package_id"](args.get("package"))
                ns["permitted"](identity, permission="play:read")
                ns["use_google"](identity, args.get("connection_id"), pkg)
                output = ns["prepare_release"](identity, pkg, args.get("track"),
                                         args.get("version_code"), args.get("release_notes"))
            elif name == "play_commit_testing_release":
                if "play:write" not in identity["scopes"]:
                    raise PermissionError("play:write scope required")
                ns["use_google"](identity, args.get("connection_id"))
                output = ns["commit_release"](identity, args.get("approval_token", ""),
                                        args.get("confirmation", ""))
            else:
                return ns["failure"](-32602, "Unknown tool", request_id)
            return ns["result"](output, request_id)
        except PermissionError:
            return ns["failure"](-32003, "Not authorized for this app or action", request_id, 403)
        except (ValueError, jwt.PyJWTError) as ex:
            return ns["failure"](-32602, str(ex), request_id)
        except Exception:
            return ns["failure"](-32000, "Publisher operation failed; check account permissions or configuration", request_id, 502)
        finally:
            ns["ACTIVE_GOOGLE_TOKEN"].set(None)
            ns["ACTIVE_CONNECTION"].set(None)
