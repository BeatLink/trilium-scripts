#!/usr/bin/env node
"use strict";
/* One-time (re-runnable) bootstrap of the golden test-data snapshot.

Copies Trilium's own e2e-test seed database (fetched via the `trilium` flake
input -- see flake.nix, exposed here as $TRILIUM_SRC) into
resources/testing/data/, boots a *real* (disk-writing) server against it,
imports TAM into it via tamhelper.js tam-to-zip + the notes-import endpoint,
then stops the server.

From then on every `trilium_server start` boots this exact snapshot
in-memory (TRILIUM_INTEGRATION_TEST=memory) and can never corrupt it -- re-run
this script any time you want to rebuild the snapshot from scratch (e.g.
after a breaking TAM change).
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const runServer = require("./run_server");
const tc = require("./trilium_client");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = runServer.DATA_DIR;
const TRILIUM_SRC = process.env.TRILIUM_SRC;

// Where each fixture file lives has moved at least once as the upstream
// TriliumNext monorepo has been restructured -- document.db used to sit
// alongside config.ini under apps/server/spec/db, then moved to
// packages/trilium-core/src/test/fixtures while config.ini stayed put. Check
// every known location for each file independently rather than assuming
// they're still siblings, so a future restructuring only needs a new
// candidate added here instead of the whole layout re-derived.
const SEED_FIXTURE_DIRS = [
    "apps/server/spec/db",
    "packages/trilium-core/src/test/fixtures",
];

function findSeedFile(name) {
    for (const relDir of SEED_FIXTURE_DIRS) {
        const candidate = path.join(TRILIUM_SRC, relDir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    const searched = SEED_FIXTURE_DIRS.map((d) => path.join(TRILIUM_SRC, d, name)).join(", ");
    console.error(`No ${name} fixture found -- looked in: ${searched} -- did the trilium flake input change shape?`);
    process.exit(1);
}

async function main() {
    if (!TRILIUM_SRC) {
        console.error("$TRILIUM_SRC not set -- run inside `nix develop` (see flake.nix)");
        process.exit(1);
    }

    if (fs.existsSync(DATA_DIR)) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const name of ["document.db", "config.ini"]) {
        const src = findSeedFile(name);
        const dest = path.join(DATA_DIR, name);
        fs.copyFileSync(src, dest);
        // Files fetched out of the Nix store are read-only (the store itself
        // is immutable) -- copyFileSync preserves that mode bit, but the
        // server needs to write to its own copy of document.db.
        fs.chmodSync(dest, 0o644);
        console.log(`Copied ${src} to ${dest}`);
    }

    console.log("Starting server for real (disk-backed) to import TAM...");
    await runServer.start(true);
    try {
        const tamZip = path.join(path.dirname(DATA_DIR), "trilium-addon-manager@beatlink.zip");
        const r = spawnSync("node", [
            path.join(REPO_ROOT, "resources", "scripts", "tamhelper.js"),
            "tam-to-zip",
            path.join(REPO_ROOT, "addons", "trilium-addon-manager@beatlink"),
            "--out", tamZip,
        ], { cwd: REPO_ROOT, stdio: "inherit" });
        if (r.status !== 0) process.exit(r.status || 1);

        const result = await tc.importZip("root", tamZip);
        const noteId = (result || {}).noteId;
        if (!noteId) {
            console.error(`TAM import didn't return a noteId -- response was: ${JSON.stringify(result)}`);
            process.exit(1);
        }
        console.log(`TAM imported as note ${noteId}`);
        fs.rmSync(tamZip, { force: true });
    } finally {
        await runServer.stop();
    }

    console.log(`Golden seed ready at ${path.join(DATA_DIR, "document.db")}`);
}

main();
