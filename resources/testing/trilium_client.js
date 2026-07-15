#!/usr/bin/env node
"use strict";
/* Thin client for a running trilium-server test instance.

The seeded config.ini sets noAuthentication=true, so no login/password is
needed for either the internal API (/api/...) or ETAPI (/etapi/...). Newer
trilium-server versions still gate every non-GET /api/... route behind
double-submit CSRF protection regardless of noAuthentication (ETAPI is
unaffected -- it isn't session/cookie-based at all), so this module
transparently does the same GET /bootstrap -> read csrfToken -> send it back
as an x-csrf-token header (alongside the session cookie the same request set)
dance a real browser session does, once per process, and reuses it for every
subsequent /api/... write.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const PORT = parseInt(process.env.TRILIUM_TESTING_PORT || "8090", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// A simple cookie jar shared across every request from this process, exactly
// like Python's http.cookiejar + build_opener(HTTPCookieProcessor).
const cookies = new Map();
let csrfToken = null;

function storeCookies(res) {
    const set = res.headers["set-cookie"];
    if (!set) return;
    for (const line of set) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
}

function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function rawRequest(method, urlPath, { body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + urlPath);
        const opts = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: { ...headers },
        };
        if (cookies.size) opts.headers["Cookie"] = cookieHeader();
        const req = http.request(opts, (res) => {
            storeCookies(res);
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`${method} ${urlPath} -> HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
                    return;
                }
                resolve(Buffer.concat(chunks));
            });
        });
        req.on("error", reject);
        if (body != null) req.write(body);
        req.end();
    });
}

async function ensureCsrf() {
    // Lazily perform the GET /bootstrap that both sets the session cookie and
    // hands back the CSRF token that cookie is bound to -- cached for the rest
    // of this process.
    if (csrfToken != null) return csrfToken;
    const raw = await rawRequest("GET", "/bootstrap");
    const data = JSON.parse(raw.toString() || "{}");
    csrfToken = data.csrfToken;
    if (!csrfToken) {
        throw new Error(`GET /bootstrap didn't return a csrfToken -- response was: ${JSON.stringify(data)}`);
    }
    return csrfToken;
}

async function request(method, urlPath, data = null, headers = null) {
    const hdrs = { ...(headers || {}) };
    let body = null;
    if (data != null) {
        body = JSON.stringify(data);
        if (!("Content-Type" in hdrs)) hdrs["Content-Type"] = "application/json";
    }
    if (method !== "GET") hdrs["x-csrf-token"] = await ensureCsrf();
    const raw = await rawRequest(method, urlPath, { body, headers: hdrs });
    return raw.length ? JSON.parse(raw.toString()) : null;
}

async function execScript(script, params = null, startNoteId = null) {
    // Run arbitrary backend JS via /api/script/exec. `script` must be a
    // function *expression* -- the server wraps it as `return
    // (${script})(${params})`. `startNoteId` doubles as both startNoteId and
    // currentNoteId; pass the noteId of an actual backend-env code note.
    const body = { script, params: params || [] };
    if (startNoteId) {
        body.startNoteId = startNoteId;
        body.currentNoteId = startNoteId;
    }
    return request("POST", "/api/script/exec", body);
}

async function importZip(parentNoteId, zipPath) {
    // Import a Trilium export zip under parentNoteId. Mirrors the same
    // multipart shape Trilium's own web UI posts to this endpoint.
    const boundary = crypto.randomUUID().replace(/-/g, "");
    const fileBytes = fs.readFileSync(zipPath);

    const fields = {
        safeImport: "true",
        textImportedAsText: "true",
        codeImportedAsCode: "true",
        explodeArchives: "true",
        last: "true",
    };
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    const filename = path.basename(zipPath);
    const contentType = filename.endsWith(".zip") ? "application/zip" : "application/octet-stream";
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    ));
    parts.push(fileBytes);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const raw = await rawRequest("POST", `/api/notes/${parentNoteId}/notes-import`, {
        body,
        headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "x-csrf-token": await ensureCsrf(),
        },
    });
    return raw.length ? JSON.parse(raw.toString()) : null;
}

async function getNote(noteId) {
    return request("GET", `/etapi/notes/${noteId}`);
}

async function searchNotes(query) {
    return request("GET", `/etapi/notes?search=${encodeURIComponent(query)}`);
}

module.exports = { execScript, importZip, getNote, searchNotes, BASE_URL, PORT };
