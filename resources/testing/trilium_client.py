#!/usr/bin/env python3
"""Thin stdlib client for a running trilium-server test instance.

The seeded config.ini sets noAuthentication=true, so no login/password is
needed for either the internal API (/api/...) or ETAPI (/etapi/...). Newer
trilium-server versions still gate every non-GET /api/... route behind
double-submit CSRF protection regardless of noAuthentication (ETAPI is
unaffected -- it isn't session/cookie-based at all), so this module
transparently does the same GET /bootstrap -> read csrfToken -> send it back
as an x-csrf-token header (alongside the session cookie the same request set)
dance a real browser session does, once per process, and reuses it for every
subsequent /api/... write. Uses only the standard library, matching this
repo's other scripts.
"""
import http.cookiejar
import json
import mimetypes
import os
import urllib.request
import uuid
from urllib.parse import quote

PORT = int(os.environ.get("TRILIUM_TESTING_PORT", "8090"))
BASE_URL = f"http://127.0.0.1:{PORT}"

_cookie_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookie_jar))
_csrf_token = None


def _ensure_csrf():
    """Lazily perform the GET /bootstrap that both sets the session cookie
    (in _cookie_jar, picked up automatically by every request through
    _opener from here on) and hands back the CSRF token that cookie is
    bound to -- cached for the rest of this process.
    """
    global _csrf_token
    if _csrf_token is not None:
        return _csrf_token
    with _opener.open(f"{BASE_URL}/bootstrap") as resp:
        data = json.loads(resp.read())
    _csrf_token = data.get("csrfToken")
    if not _csrf_token:
        raise RuntimeError(f"GET /bootstrap didn't return a csrfToken -- response was: {data}")
    return _csrf_token


def _request(method, path, data=None, headers=None):
    url = f"{BASE_URL}{path}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    if body is not None and "Content-Type" not in req.headers:
        req.add_header("Content-Type", "application/json")
    if method != "GET":
        req.add_header("x-csrf-token", _ensure_csrf())
    with _opener.open(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def exec_script(script, params=None, start_note_id=None):
    """Run arbitrary backend JS via /api/script/exec. `script` must be a
    function *expression* (e.g. "function(){ return 1+1; }" or an arrow
    function) — the server wraps it as `return (${script})(${params})`, so a
    bare statement like "return 1+1;" fails with "Unexpected token 'return'".
    Enough to call into libTAMjs, inspect/mutate any note, etc. with no
    browser involved.

    `start_note_id` doubles as both startNoteId and currentNoteId. The
    server's executeScript needs *currentNoteId* to resolve a real code note
    (of type=code, backend-env mime) to derive the script's execution bundle
    from — startNoteId alone throws "Cannot find note.", and a non-code note
    (e.g. "root") throws "Unable to determine script bundle." So pass the
    noteId of an actual backend-env code note here, not just any note.
    """
    body = {"script": script, "params": params or []}
    if start_note_id:
        body["startNoteId"] = start_note_id
        body["currentNoteId"] = start_note_id
    return _request("POST", "/api/script/exec", body)


def import_zip(parent_note_id, zip_path):
    """Import a Trilium export zip (e.g. built by tam_to_zip.py) under
    parent_note_id. Mirrors the same multipart shape Trilium's own web UI
    posts to this endpoint.
    """
    boundary = uuid.uuid4().hex
    with open(zip_path, "rb") as f:
        file_bytes = f.read()

    fields = {
        "safeImport": "true",
        "textImportedAsText": "true",
        "codeImportedAsCode": "true",
        "explodeArchives": "true",
        "last": "true",
    }
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    filename = os.path.basename(zip_path)
    content_type = mimetypes.guess_type(filename)[0] or "application/zip"
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="upload"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode()
    )
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        f"{BASE_URL}/api/notes/{parent_note_id}/notes-import",
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "x-csrf-token": _ensure_csrf(),
        },
    )
    with _opener.open(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def get_note(note_id):
    return _request("GET", f"/etapi/notes/{note_id}")


def search_notes(query):
    return _request("GET", f"/etapi/notes?search={quote(query)}")
