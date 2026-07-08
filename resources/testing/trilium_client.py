#!/usr/bin/env python3
"""Thin stdlib client for a running trilium-server test instance.

The seeded config.ini sets noAuthentication=true, so both the internal API
(/api/...) and ETAPI (/etapi/...) are callable with no token/session at all.
Uses only the standard library, matching this repo's other scripts.
"""
import json
import mimetypes
import os
import urllib.request
import uuid
from urllib.parse import quote

PORT = int(os.environ.get("TRILIUM_TESTING_PORT", "8090"))
BASE_URL = f"http://127.0.0.1:{PORT}"


def _request(method, path, data=None, headers=None):
    url = f"{BASE_URL}{path}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    if body is not None and "Content-Type" not in req.headers:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def exec_script(script, params=None, start_note_id=None):
    """Run arbitrary backend JS via /api/script/exec — `script` is executed
    as a function body (use `return ...` to get a value back in
    executionResult). Enough to call into libTAMjs, inspect/mutate any note,
    etc. with no browser involved.
    """
    body = {"script": script, "params": params or []}
    if start_note_id:
        body["startNoteId"] = start_note_id
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
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def get_note(note_id):
    return _request("GET", f"/etapi/notes/{note_id}")


def search_notes(query):
    return _request("GET", f"/etapi/notes?search={quote(query)}")
