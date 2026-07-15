#!/usr/bin/env node
"use strict";
/* Consolidated Trilium testing harness.

One module holding every primitive the Playwright suite needs, so the whole
"start Trilium, load a test environment, deploy TAM, drive it" flow is a single
`playwright test` run (see playwright.config.js -- its globalSetup calls
`prepare()` here, its fixtures call `httpClient()` / `triliumPage()`).

Pieces (previously seed.js / run_server.js / trilium_client.js /
browser_client.js -- now folded into one file):

  seed()      copy Trilium's own e2e fixture db + import TAM  -> golden snapshot
  start()     boot trilium-server against that snapshot (in-memory by default)
  stop()      stop it
  prepare()   seed-if-needed + start; the one call globalSetup makes
  httpClient  no-auth /api + /etapi client (execScript, importZip, search...)
  TriliumPage Playwright Page wrapper (gotoNote, enableRenderNote)

Requires `trilium-server` on PATH and $TRILIUM_SRC set -- both provided by this
repo's flake devShell (`nix develop`), never installed separately.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.TRILIUM_TESTING_DATA_DIR ||
    path.join(REPO_ROOT, "resources", "testing", "data");
const PORT = parseInt(process.env.TRILIUM_TESTING_PORT || "8090", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PIDFILE = path.join(path.dirname(DATA_DIR), ".server.pid");
const LOGFILE = path.join(path.dirname(DATA_DIR), "server.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------------------
// Server lifecycle
// -------------------------------------------------------------------------

function which(cmd) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

function isRunning() {
    if (!fs.existsSync(PIDFILE)) return null;
    let pid;
    try {
        pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    } catch {
        return null;
    }
    if (Number.isNaN(pid)) return null;
    try {
        process.kill(pid, 0);
    } catch {
        return null;
    }
    return pid;
}

function ping(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 1000 }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}

async function start(real = false) {
    const running = isRunning();
    if (running) return running;

    if (!fs.existsSync(DATA_DIR)) {
        throw new Error(`No data dir at ${DATA_DIR} -- seed hasn't run`);
    }
    if (which("trilium-server") === null) {
        throw new Error("trilium-server not on PATH -- run inside `nix develop`");
    }

    const env = { ...process.env };
    env.TRILIUM_DATA_DIR = DATA_DIR;
    env.TRILIUM_NETWORK_PORT = String(PORT);
    if (!real) env.TRILIUM_INTEGRATION_TEST = "memory";

    const log = fs.openSync(LOGFILE, "w");
    const proc = spawn("trilium-server", [], { env, stdio: ["ignore", log, log], detached: true });
    proc.unref();
    fs.writeFileSync(PIDFILE, String(proc.pid));

    for (let i = 0; i < 60; i++) {
        if (await ping(BASE_URL + "/")) return proc.pid;
        // If the process already died, stop waiting the full 60s.
        try { process.kill(proc.pid, 0); } catch {
            throw new Error(`trilium-server exited during startup -- check ${LOGFILE}`);
        }
        await sleep(1000);
    }
    throw new Error(`Server didn't come up in time -- check ${LOGFILE}`);
}

async function stop() {
    const pid = isRunning();
    fs.rmSync(PIDFILE, { force: true });
    if (!pid) return;
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 10; i++) {
        try {
            process.kill(pid, 0);
            await sleep(500);
        } catch {
            break;
        }
    }
}

// -------------------------------------------------------------------------
// HTTP client (no-auth /api + /etapi). One instance per process; owns its
// own cookie jar + CSRF token exactly like a real browser session.
// -------------------------------------------------------------------------

function httpClient() {
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
        // Run backend JS via /api/script/exec. `script` is a function
        // *expression*; the server wraps it as `return (${script})(${params})`.
        const body = { script, params: params || [] };
        if (startNoteId) {
            body.startNoteId = startNoteId;
            body.currentNoteId = startNoteId;
        }
        return request("POST", "/api/script/exec", body);
    }

    async function importZip(parentNoteId, zipPath) {
        // Mirrors the multipart shape Trilium's own web UI posts.
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
        const raw = await rawRequest("POST", `/api/notes/${parentNoteId}/notes-import`, {
            body: Buffer.concat(parts),
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "x-csrf-token": await ensureCsrf(),
            },
        });
        return raw.length ? JSON.parse(raw.toString()) : null;
    }

    const getNote = (noteId) => request("GET", `/etapi/notes/${noteId}`);
    const searchNotes = (query) => request("GET", `/etapi/notes?search=${encodeURIComponent(query)}`);

    return { execScript, importZip, getNote, searchNotes, request, BASE_URL, PORT };
}

// -------------------------------------------------------------------------
// Browser layer: a Playwright Page pre-aimed at this trilium-server. Unknown
// methods/props fall through to the underlying Page via Proxy.
// PLAYWRIGHT_BROWSERS_PATH / PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS come
// from the flake shellHook so `playwright install` is never needed.
// -------------------------------------------------------------------------

function wrapPage(page) {
    const helpers = {
        page,
        async gotoNote(noteId, waitSeconds = 3) {
            await page.goto(`${BASE_URL}/#root/${noteId}`, { waitUntil: "networkidle" });
            await sleep(waitSeconds * 1000);
            return this;
        },
        async enableRenderNote(waitSeconds = 3) {
            // Dismiss the one-time "untrusted render note" trust warning.
            const btns = page.getByRole("button", { name: "Enable render note" });
            if (await btns.count() > 0) {
                await btns.first().click({ force: true });
                await sleep(waitSeconds * 1000);
            }
            return this;
        },
    };
    return new Proxy(helpers, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            const val = page[prop];
            return typeof val === "function" ? val.bind(page) : val;
        },
    });
}

// -------------------------------------------------------------------------
// Seed: build the golden snapshot (Trilium's own e2e fixture db + TAM imported)
// -------------------------------------------------------------------------

// Where each fixture file lives has moved as the upstream monorepo has been
// restructured -- check every known location per file independently so a
// future move only needs a new candidate added here.
const SEED_FIXTURE_DIRS = [
    "apps/server/spec/db",
    "packages/trilium-core/src/test/fixtures",
];

function findSeedFile(triliumSrc, name) {
    for (const relDir of SEED_FIXTURE_DIRS) {
        const candidate = path.join(triliumSrc, relDir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    const searched = SEED_FIXTURE_DIRS.map((d) => path.join(triliumSrc, d, name)).join(", ");
    throw new Error(`No ${name} fixture found -- looked in: ${searched} -- did the trilium flake input change shape?`);
}

async function seed() {
    const triliumSrc = process.env.TRILIUM_SRC;
    if (!triliumSrc) {
        throw new Error("$TRILIUM_SRC not set -- run inside `nix develop` (see flake.nix)");
    }

    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const name of ["document.db", "config.ini"]) {
        const src = findSeedFile(triliumSrc, name);
        const dest = path.join(DATA_DIR, name);
        fs.copyFileSync(src, dest);
        // Nix-store files are read-only; the server needs to write its copy.
        fs.chmodSync(dest, 0o644);
    }

    // Boot disk-backed (writes persist) so the TAM import lands in the snapshot.
    await start(true);
    try {
        const client = httpClient();
        const tamZip = path.join(path.dirname(DATA_DIR), "trilium-addon-manager@beatlink.zip");
        const r = spawnSync("node", [
            path.join(REPO_ROOT, "resources", "scripts", "tamhelper.js"),
            "tam-to-zip",
            path.join(REPO_ROOT, "addons", "trilium-addon-manager@beatlink"),
            "--out", tamZip,
        ], { cwd: REPO_ROOT, stdio: "inherit" });
        if (r.status !== 0) throw new Error(`tam-to-zip failed (exit ${r.status})`);

        const result = await client.importZip("root", tamZip);
        const noteId = (result || {}).noteId;
        if (!noteId) {
            throw new Error(`TAM import didn't return a noteId -- response was: ${JSON.stringify(result)}`);
        }
        fs.rmSync(tamZip, { force: true });
    } finally {
        await stop();
    }
}

// -------------------------------------------------------------------------
// prepare(): the single call globalSetup makes -- rebuild the golden snapshot,
// then start the server against it. Returns a teardown fn.
//
// It re-seeds every run rather than reusing a prior snapshot because the server
// runs disk-backed: TRILIUM_INTEGRATION_TEST=memory (which would load the db
// read-only into RAM so test writes never touch the file) currently crashes on
// boot with SQLITE_CANTOPEN in trilium-server 0.103 -- so a test run persists
// whatever it wrote, and the only way to guarantee every run starts from the
// same known state is to rebuild from Trilium's own immutable fixture each time.
// Seeding is cheap (a file copy + one TAM zip import). Set
// TRILIUM_TESTING_NO_RESEED=1 to skip it and reuse the existing snapshot when
// iterating on tests that don't mutate state.
// -------------------------------------------------------------------------

async function prepare() {
    const dbPath = path.join(DATA_DIR, "document.db");
    const skipSeed = process.env.TRILIUM_TESTING_NO_RESEED === "1" && fs.existsSync(dbPath);
    if (!skipSeed) await seed();

    await start(true);
    return async () => { await stop(); };
}

module.exports = {
    seed, start, stop, prepare, isRunning,
    httpClient, wrapPage,
    DATA_DIR, PORT, BASE_URL, PIDFILE, LOGFILE,
};

// CLI escape hatch for the rare manual case (e.g. debugging the seed, or
// leaving a server up to poke by hand) -- the normal path is `playwright test`.
if (require.main === module) {
    const cmd = process.argv[2];
    const real = process.argv.includes("--real");
    (async () => {
        if (cmd === "seed") {
            await seed();
            console.log(`Golden seed ready at ${path.join(DATA_DIR, "document.db")}`);
        } else if (cmd === "start") {
            const pid = await start(real);
            console.log(`Server ready at ${BASE_URL}/ (pid ${pid})`);
        } else if (cmd === "stop") {
            await stop();
            console.log("Stopped");
        } else {
            process.stderr.write(
                "Usage: node resources/testing/harness.js <seed|start [--real]|stop>\n" +
                "(normal path is `playwright test` -- this CLI is for manual debugging)\n"
            );
            process.exit(1);
        }
    })().catch((e) => { console.error(e.message); process.exit(1); });
}
