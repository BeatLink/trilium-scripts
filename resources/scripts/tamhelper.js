#!/usr/bin/env node
"use strict";
/* TAM addon toolchain -- one entry point for every build/validate/publish step.

Subcommands (run `tamhelper.js <cmd> -h` for each one's flags):

  validate              Lint every addon manifest before publishing.
  tam-to-zip            Convert a manifest (or --all) into a Trilium ZIP import.
  zip-to-tam            Convert a Trilium export ZIP into a manifest + source files.
  generate-pages        Build the GitHub Pages site (docs/, incl. catalog.json).
  generate-readme       Regenerate README.md's addon table from manifests.
  publish-release       Upload built *.zip files to GitHub Releases.
  backfill-source-url   Add manifestSourceUrl to every manifest missing one.
*/

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const MANIFEST_NAME = "_tam_manifest_.json";

// One MIME<->extension table, used in both build directions. tam-to-zip needs
// mime -> ext; zip-to-tam needs ext -> mime, with a preferred mime per ext.
const MIME_TO_EXT = {
    "text/html":                            ".html",
    "text/markdown":                        ".md",
    "text/jsx":                             ".jsx",
    "text/css":                             ".css",
    "text/x-python":                        ".py",
    "text/plain":                           ".txt",
    "application/json":                     ".json",
    "application/javascript":               ".js",
    "application/javascript;env=frontend":  ".js",
    "application/javascript;env=backend":   ".js",
    "application/javascript;env=hybrid":    ".js",
    "audio/wav":                            ".wav",
};
const EXT_TO_MIME = {
    ".js":   "application/javascript;env=frontend",
    ".jsx":  "text/jsx",
    ".css":  "text/css",
    ".json": "application/json",
    ".html": "text/html",
    ".md":   "text/markdown",
    ".py":   "text/x-python",
};

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";


// ---------------------------------------------------------------------------
// Small stdlib-shaped helpers (Python parity)
// ---------------------------------------------------------------------------

function die(msg) {
    process.stderr.write(msg + "\n");
    process.exit(1);
}

function htmlEscape(s, quote = true) {
    s = String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    if (quote) {
        s = s.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    }
    return s;
}

function randChoices(chars, k) {
    let out = "";
    for (let i = 0; i < k; i++) {
        out += chars[crypto.randomInt(chars.length)];
    }
    return out;
}

// Python's json.dumps(obj, indent=N): keys in insertion order, spaces after
// ':' and ','. JSON.stringify with an indent already matches this closely.
function jsonDumps(obj, indent) {
    return JSON.stringify(obj, null, indent);
}

function readText(p) {
    return fs.readFileSync(p, "utf8");
}

function writeText(p, text) {
    fs.writeFileSync(p, text);
}

function exists(p) {
    return fs.existsSync(p);
}

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function suffixOf(name) {
    const base = path.basename(name);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot) : "";
}

function stemOf(name) {
    const base = path.basename(name);
    const suf = suffixOf(name);
    return suf ? base.slice(0, base.length - suf.length) : base;
}


// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function iterManifests(addonsDir = "addons") {
    // Sorted paths to every addons/*/_tam_manifest_.json.
    let names;
    try {
        names = fs.readdirSync(addonsDir);
    } catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        const mf = path.join(addonsDir, name, MANIFEST_NAME);
        if (exists(mf)) out.push(mf);
    }
    out.sort();
    return out;
}


function uniqueName(base, used) {
    // Return `base`, or `base-2`/`base-3`/... if taken. A name with an
    // extension is disambiguated before the extension (foo.js -> foo-2.js).
    // `used` is a Set that this call adds the result to.
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    const suffix = suffixOf(base);
    const stem = suffix ? stemOf(base) : base;
    let i = 2;
    while (used.has(`${stem}-${i}${suffix}`)) i++;
    const result = `${stem}-${i}${suffix}`;
    used.add(result);
    return result;
}


// Local ids whose children[] parent chain roots at the reserved "persistence" parent keyword.
// Empty set when nothing attaches there. MUST stay in sync with persistentLocalIds() in lib-tam.js.
function persistentLocalIds(m) {
    const persistent = new Set();
    const childrenOf = {};
    for (const c of (m.children || []).filter((c) => c.child)) {
        (childrenOf[c.parent] = childrenOf[c.parent] || []).push(c.child);
    }
    const stack = [...(childrenOf["persistence"] || [])];
    for (const id of stack) persistent.add(id);
    while (stack.length) {
        for (const child of childrenOf[stack.pop()] || []) {
            if (!persistent.has(child)) {
                persistent.add(child);
                stack.push(child);
            }
        }
    }
    return persistent;
}


function runGit(args, cwd) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim();
}


async function fetchBuffer(url) {
    // Every note's sourceUrl is an absolute URL (see lib-tam.js's resolveNotes) --
    // tam-to-zip fetches the same way TAM itself does at install time, rather than
    // reading a local file, so a local build always reflects what's actually published.
    // encodeURI leaves an already-escaped URL untouched but escapes raw special
    // chars (e.g. "@" in an addon dir name) that otherwise make GitHub/CDN caches
    // key the request differently -- see lib-tam.js's fetchWithRetry.
    const response = await fetch(encodeURI(url));
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    return Buffer.from(await response.arrayBuffer());
}


const GITHUB_REMOTE_RE = /^(?:git@github\.com:|https:\/\/github\.com\/)(.+?)(?:\.git)?$/;


function detectManifestSourceUrl(outDir) {
    // Best-effort raw.githubusercontent URL this manifest will be reachable at
    // (tracking the current branch), or null if outDir isn't inside a git working
    // copy with a github.com origin remote on a named branch.
    outDir = path.resolve(outDir);
    let repoRoot = runGit(["rev-parse", "--show-toplevel"], outDir);
    if (!repoRoot) return null;
    repoRoot = path.resolve(repoRoot);

    const remoteUrl = runGit(["remote", "get-url", "origin"], repoRoot);
    if (!remoteUrl) return null;
    const match = GITHUB_REMOTE_RE.exec(remoteUrl);
    if (!match) return null;

    const branch = runGit(["symbolic-ref", "--short", "HEAD"], repoRoot);
    if (!branch) return null; // detached HEAD or other odd state

    const relativeDir = path.relative(repoRoot, outDir);
    if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) return null;

    const parts = relativeDir.split(path.sep).filter(Boolean);
    const manifestPath = [...parts, MANIFEST_NAME].join("/");
    return `https://raw.githubusercontent.com/${match[1]}/refs/heads/${branch}/${manifestPath}`;
}


function loadAddons() {
    // Parse every addon manifest under addons/ into {meta, readmeHtml, outerDir}.
    if (!isDir("addons")) {
        die("ERROR: no 'addons/' directory -- run from repo root");
    }

    const addons = [];
    for (const metaFile of iterManifests()) {
        let meta;
        try {
            meta = JSON.parse(readText(metaFile));
        } catch (e) {
            console.log(`WARNING: skipping ${metaFile}: ${e.message}`);
            continue;
        }
        if (!meta.id) continue;

        const outerDir = path.dirname(metaFile);
        let readmeHtml = "";
        const readmeRel = meta.readme;
        if (readmeRel && exists(path.join(outerDir, readmeRel))) {
            readmeHtml = renderMd(readText(path.join(outerDir, readmeRel)));
        }

        addons.push({ meta, readmeHtml, outerDir });
    }
    return addons;
}


// ===========================================================================
// validate
// ===========================================================================

const REQUIRED_FIELDS = ["id", "name", "description", "author", "homepage", "license", "latestVersion", "type"];
const GENERIC_TITLES = new Set(["lib", "library", "libsettings", "settings", "utils", "helper", "helpers"]);


async function cmdValidate(args) {
    const errors = [], warnings = [], fixes = [];

    const error = (p, msg) => errors.push(`ERROR   ${p}: ${msg}`);
    const warn = (p, msg) => warnings.push(`WARNING ${p}: ${msg}`);

    const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;
    const importRe = /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
    const exportRe = /^\s*export\s+(const|let|var|function|class|default|\{)/m;

    const manifestFiles = iterManifests();
    for (const manifestFile of manifestFiles) {
        const addonDir = path.dirname(manifestFile);

        let manifest;
        try {
            manifest = JSON.parse(readText(manifestFile));
        } catch (e) {
            error(manifestFile, `invalid JSON -- ${e.message}`);
            continue;
        }

        const addonId = manifest.id;
        if (!addonId) {
            error(manifestFile, "missing required field 'id'");
            continue;
        }

        for (const field of REQUIRED_FIELDS) {
            if (!(field in manifest)) {
                warn(manifestFile, `missing field '${field}'`);
            }
        }

        if (addonId.includes(" ")) {
            error(manifestFile, `'id' contains spaces: "${addonId}"`);
            continue;
        }

        // homepage URL must end with addons/{id} (only when it contains /addons/)
        const homepage = manifest.homepage || "";
        if (homepage) {
            let parsedUrl;
            try {
                parsedUrl = new URL(homepage);
            } catch {
                parsedUrl = null;
            }
            if (parsedUrl) {
                const decodedPath = decodeURIComponent(parsedUrl.pathname).replace(/\/+$/, "");
                const expected = `addons/${addonId}`;
                if (decodedPath.includes("/addons/") && !decodedPath.endsWith(expected)) {
                    if (args.fix) {
                        let parts = decodedPath.split("/");
                        const revIdx = [...parts].reverse().indexOf("addons");
                        if (revIdx !== -1) {
                            const addonsIdx = parts.length - 1 - revIdx;
                            parts = parts.slice(0, addonsIdx + 1).concat([addonId]);
                        } else {
                            parts[parts.length - 1] = addonId;
                        }
                        parsedUrl.pathname = parts.join("/");
                        const newHomepage = parsedUrl.toString();
                        manifest.homepage = newHomepage;
                        writeText(manifestFile, jsonDumps(manifest, 4) + "\n");
                        fixes.push(`FIXED   updated homepage in '${manifestFile}': '${homepage}' -> '${newHomepage}'`);
                    } else {
                        warn(manifestFile, `homepage does not end with 'addons/${addonId}' (run --fix to update)`);
                    }
                }
            }
        }

        const readmeRel = manifest.readme;
        if (readmeRel && !exists(path.join(addonDir, readmeRel))) {
            error(manifestFile, `'readme' points to "${readmeRel}" but file not found`);
        }

        if (!manifest.manifestSourceUrl) {
            warn(manifestFile, "missing 'manifestSourceUrl' -- addon can't be installed by TAM until this is set");
        }

        const m = manifest.manifest;
        if (m == null) {
            continue; // metadata-only addon
        }

        const notes = m.notes;
        if (!Array.isArray(notes)) {
            error(manifestFile, "manifest.notes must be an array");
            continue;
        }

        const noteIds = new Set(), byId = {};
        for (const note of notes) {
            const nid = note.id || note.title;
            if (nid) {
                noteIds.add(nid);
                byId[nid] = note;
            }
            if (!note.title) {
                warn(manifestFile, `note '${nid}' missing 'title'`);
            }
        }

        // TAM itself bootstraps via a manual ZIP import, so its own manifest is the one
        // exception that still declares a real root note. Every other addon's root is
        // synthesized by TAM (ensureAddonAnchor) -- its manifest only ever references it via
        // the reserved "root" parent keyword in children[], never as a notes[] entry.
        const rootId = m.root;
        if (rootId) {
            if (!noteIds.has(rootId)) {
                error(manifestFile, `manifest.root '${rootId}' not found in notes`);
            }
        } else if (!(m.children || []).some((c) => c.parent === "root")) {
            error(manifestFile, "manifest.children must attach at least one note to the reserved \"root\" parent");
        }

        for (const field of ["settingsNote", "readmeNote"]) {
            const localId = m[field];
            if (localId && !noteIds.has(localId)) {
                error(manifestFile, `manifest.${field} '${localId}' not found in notes`);
            }
        }

        // Local ids whose children[] parent chain roots at the reserved "persistence" parent
        // keyword -- these are "persistent": created once, prompt-on-update, never touched by
        // uninstall.
        const persistentIds = persistentLocalIds(m);

        // settingsNote should point at a render note, not the raw code note
        const settingsNote = byId[m.settingsNote];
        if (settingsNote && settingsNote.type === "code") {
            warn(manifestFile, `settingsNote '${m.settingsNote}' is a raw code note -- point it at the wrapping render note instead`);
        }

        // Notes served as static HTTP resources are exempt from the env check.
        const resourceNoteIds = new Set(
            (m.labels || [])
                .filter((lbl) => lbl.name === "customResourceProvider")
                .map((lbl) => lbl.note)
        );

        for (const note of notes) {
            const nid = note.id || note.title || "?";
            const mime = note.mime || "";
            if (mime.startsWith("application/javascript")) {
                if (mime.includes("env=hybrid")) {
                    error(manifestFile, `note '${nid}': mime declares 'env=hybrid', which does not exist -- ship two notes (env=frontend + env=backend) instead`);
                } else if (!mime.includes("env=frontend") && !mime.includes("env=backend") && !resourceNoteIds.has(nid)) {
                    warn(manifestFile, `note '${nid}': mime '${mime}' is missing an env=frontend/env=backend qualifier`);
                }
            }
        }

        // plain .js notes are never transpiled -- ES export/import will throw
        for (const note of notes) {
            const nid = note.id || note.title || "?";
            const sourceUrl = note.sourceUrl || "";
            if (sourceUrl.endsWith(".js")) {
                try {
                    const src = await (await fetchBuffer(sourceUrl)).toString("utf8");
                    if (exportRe.test(src)) {
                        warn(manifestFile, `note '${nid}': plain .js source uses ES 'export' syntax, which is not transpiled -- use CommonJS module.exports instead`);
                    }
                } catch (e) {
                    warn(manifestFile, `note '${nid}': sourceUrl '${sourceUrl}' fetch failed (${e.message})`);
                }
            }
        }

        // notes unreachable from root (or persistenceRoot) via children[] will never be created
        const localChildren = new Set(
            (m.children || []).filter((c) => c.child).map((c) => c.child)
        );
        for (const nid of noteIds) {
            if (nid !== rootId && !localChildren.has(nid)) {
                warn(manifestFile, `note '${nid}' is not attached under any parent in 'children' -- it will never be created`);
            }
        }

        // skipOnUpdate/promptOnUpdate are implied by placement under the reserved "persistence"
        // parent -- redundant there
        for (const note of notes) {
            const nid = note.id || note.title || "?";
            if (persistentIds.has(nid) && (note.skipOnUpdate || note.promptOnUpdate)) {
                warn(manifestFile, `note '${nid}' is attached under the reserved "persistence" parent, so skipOnUpdate/promptOnUpdate is implied and should be removed`);
            }
        }

        // generic library titles collide globally across addons
        for (const note of notes) {
            const title = note.title || "";
            if (GENERIC_TITLES.has(title.toLowerCase()) && note.type === "code") {
                warn(manifestFile, `note title '${title}' is generic -- require()/the bundle-global namespace is shared across all addons; use a fully-qualified title`);
            }
        }

        // sourceUrl files must be fetchable
        for (const note of notes) {
            const nid = note.id || note.title || "?";
            const sourceUrl = note.sourceUrl;
            if (sourceUrl) {
                try {
                    await fetchBuffer(sourceUrl);
                } catch (e) {
                    error(manifestFile, `note '${nid}': sourceUrl '${sourceUrl}' fetch failed (${e.message})`);
                }
            }
        }

        // children references. "root"/"persistence" are reserved parent keywords meaning
        // "TAM's synthesized structural/persistence anchor" -- never real declared notes.
        for (const c of m.children || []) {
            const parent = c.parent, child = c.child;
            if (parent && parent !== "root" && parent !== "persistence" && !noteIds.has(parent)) {
                error(manifestFile, `children: parent '${parent}' not found in notes`);
            }
            if (child && !noteIds.has(child)) {
                error(manifestFile, `children: child '${child}' not found in notes`);
            }
        }

        // relations references
        for (const rel of m.relations || []) {
            const fromId = rel.from, toId = rel.to;
            if (fromId && !noteIds.has(fromId)) {
                error(manifestFile, `relations: from '${fromId}' not found in notes`);
            }
            if (toId && !noteIds.has(toId)) {
                warn(manifestFile, `relations: to '${toId}' not found in notes (may be a literal noteId)`);
            }
        }

        // labels references
        for (const label of m.labels || []) {
            const nid = label.note;
            if (nid && !noteIds.has(nid)) {
                error(manifestFile, `labels: note '${nid}' not found in notes`);
            }
        }

        // require()/import targets must be co-installed in the requiring note's subtree
        await validateRequireReachability(manifestFile, m, notes, requireRe, importRe, warn);
    }

    for (const msg of [...fixes, ...warnings, ...errors]) {
        console.log(msg);
    }
    if (!(fixes.length || warnings.length || errors.length)) {
        console.log(`OK -- ${manifestFiles.length} addon(s) validated successfully`);
    }
    if (errors.length) {
        process.exit(1);
    }
}


async function validateRequireReachability(manifestFile, m, notes, requireRe, importRe, warn) {
    // A code note that require()s/imports another note by title resolves it
    // within its own installed subtree. Warn when a target isn't reachable there.
    const idToTitle = {};
    for (const n of notes) {
        idToTitle[n.id || n.title] = n.title || "";
    }
    const localTitles = new Set(Object.values(idToTitle).filter(Boolean));

    const localChildEdges = {};
    for (const c of m.children || []) {
        const parent = c.parent;
        if (!parent || !c.child) continue;
        (localChildEdges[parent] ||= []).push(c.child);
    }

    function descendants(startId) {
        const seen = new Set();
        const stack = [startId];
        while (stack.length) {
            const cur = stack.pop();
            if (seen.has(cur)) continue;
            seen.add(cur);
            stack.push(...(localChildEdges[cur] || []));
        }
        return seen;
    }

    for (const note of notes) {
        if (note.type !== "code") continue;
        const mime = note.mime || "";
        if (!(mime.startsWith("application/javascript") || mime.includes("jsx"))) continue;
        const sourceUrl = note.sourceUrl || "";
        if (!sourceUrl) continue;

        let src;
        try {
            src = (await fetchBuffer(sourceUrl)).toString("utf8");
        } catch (e) {
            continue; // already reported by the sourceUrl-must-be-fetchable check above
        }
        const targets = new Set();
        for (const mm of src.matchAll(requireRe)) targets.add(mm[1]);
        for (const mm of src.matchAll(importRe)) targets.add(mm[1]);
        const filtered = new Set([...targets].filter((t) => t.endsWith(".js") || t.endsWith(".jsx")));
        if (!filtered.size) continue;

        const nid = note.id || note.title;
        const subtree = descendants(nid);
        const reachable = new Set();
        for (const d of subtree) reachable.add(idToTitle[d] || "");

        for (const t of [...filtered].sort()) {
            if (reachable.has(t)) continue;
            if (localTitles.has(t)) {
                warn(manifestFile, `note '${nid}': require/import of '${t}' resolves to a local note wired outside this note's subtree -- it won't be found at runtime`);
            } else {
                warn(manifestFile, `note '${nid}': require/import of '${t}' is not installed in this note's subtree -- wire it under '${nid}' via children[]`);
            }
        }
    }
}


// ===========================================================================
// tam-to-zip
// ===========================================================================

const TRILIUM_APP_VERSION = "0.103.0";


function safeName(title) {
    return title.replace(/\//g, "-").replace(/\\/g, "-");
}


// Local id for the synthetic root entry `processManifest` builds when a manifest has no
// declared `m.root` -- must match addonAnchorRootLocalId in lib-tam.js, since a ZIP-installed
// note's #TAMFILEID has to line up with what TAM's own ensureAddonAnchor would create live.
const SYNTHETIC_ROOT_LOCAL_ID = "__tamAddonRoot__";
// Same idea for whatever attaches under the reserved "persistence" parent keyword -- must match
// addonAnchorPersistenceLocalId in lib-tam.js. Live sync parents this under the separate global
// "Addon Data" anchor; a ZIP export is one tree, so it's nested under the synthetic root here
// purely as an export approximation.
const SYNTHETIC_PERSISTENCE_LOCAL_ID = "__tamAddonPersistenceRoot__";

async function processManifest(fullManifest) {
    // Build ZIP entries for one manifest.
    // Returns { rootEntry, zipFiles, warnings, uuidMap }.
    const m = fullManifest.manifest || {};

    const notesById = {};
    for (const n of m.notes || []) notesById[n.id] = n;

    // No declared m.root -- every addon but TAM itself. TAM synthesizes this note live
    // (ensureAddonAnchor); mirror that here purely so the ZIP has a single top-level note to
    // build around, titled after the addon, content-free, TAM's own icon.
    const rootLid = m.root || SYNTHETIC_ROOT_LOCAL_ID;
    if (!m.root) {
        notesById[rootLid] = { id: rootLid, title: fullManifest.name || fullManifest.id, type: "text", mime: "text/html", sourceUrl: null };
    }

    const hasPersistence = (m.children || []).some((c) => c.parent === "persistence");
    const persistenceLid = SYNTHETIC_PERSISTENCE_LOCAL_ID;
    if (hasPersistence) {
        notesById[persistenceLid] = { id: persistenceLid, title: "Persistence", type: "text", mime: "text/html", sourceUrl: null };
    }

    const uuidMap = {};
    for (const lid of Object.keys(notesById)) uuidMap[lid] = randChoices(ID_CHARS, 12);

    // A child listed under >1 parent builds only on first occurrence; later
    // occurrences become isClone references to the same generated noteId.
    const childrenMap = {}, seenChildren = new Set();
    for (const c of m.children || []) {
        const childLid = c.child;
        const isCloneRef = seenChildren.has(childLid);
        seenChildren.add(childLid);
        // The reserved "root"/"persistence" parent keywords mean "TAM's synthesized anchor" --
        // redirect to the matching synthetic entry's local id so buildEntry finds its children
        // under the right key.
        let parentLid = c.parent;
        if (!m.root && c.parent === "root") parentLid = rootLid;
        else if (c.parent === "persistence") parentLid = persistenceLid;
        (childrenMap[parentLid] ||= []).push([childLid, isCloneRef]);
    }
    if (hasPersistence) {
        (childrenMap[rootLid] ||= []).push([persistenceLid, false]);
    }

    const noteLabels = {}, noteRelations = {};
    for (const lbl of m.labels || []) (noteLabels[lbl.note] ||= []).push(lbl);
    for (const rel of m.relations || []) (noteRelations[rel.from] ||= []).push(rel);
    // The synthetic anchors' own #iconClass -- TAM sets this uniformly on every anchor it owns.
    if (!m.root) noteLabels[rootLid] = [{ note: rootLid, name: "iconClass", value: "bx bx-customize" }];
    if (hasPersistence) noteLabels[persistenceLid] = [{ note: persistenceLid, name: "iconClass", value: "bx bx-customize" }];

    const zipFiles = [], warnings = [];
    const usedBases = {};

    function uniqueBase(dirPrefix, base) {
        const set = (usedBases[dirPrefix] ||= new Set());
        return uniqueName(base, set);
    }

    async function buildEntry(localId, notePosition, dirPrefix, notePath) {
        const noteDef = notesById[localId];
        const noteUuid = uuidMap[localId];
        // Match Python's dict.get(key, default): a present-but-empty value
        // ("mime": "" on a render note) stays empty, it is not defaulted.
        const noteType = "type" in noteDef ? noteDef.type : "text";
        const noteMime = "mime" in noteDef ? noteDef.mime : "text/html";
        const title = noteDef.title;

        const localChildren = childrenMap[localId] || [];
        const hasChildren = Boolean(localChildren.length);
        const currentPath = [...notePath, noteUuid];

        const ext = noteType === "render" ? ".html" : (MIME_TO_EXT[noteMime] || ".html");
        const base = uniqueBase(dirPrefix, safeName(title));
        const dataName = base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
        let dirName = hasChildren ? base : null;

        // A title carrying its own extension (e.g. "libTAM.js") makes
        // dataName == base == dirName once it gains a child -- impossible on a
        // filesystem/zip. Reserve a second name to disambiguate.
        if (dirName !== null && dirName === dataName) {
            dirName = uniqueBase(dirPrefix, dirName);
        }

        let content;
        if (noteType === "render") {
            content = Buffer.alloc(0);
        } else {
            const sourceUrl = noteDef.sourceUrl;
            if (sourceUrl) {
                try {
                    content = await fetchBuffer(sourceUrl);
                } catch (e) {
                    warnings.push(`note '${localId}': sourceUrl '${sourceUrl}' fetch failed (${e.message}) -- empty content used`);
                    content = Buffer.alloc(0);
                }
            } else if (noteDef.content != null) {
                const c = noteDef.content;
                content = typeof c === "string" ? Buffer.from(c) : Buffer.from(c);
            } else {
                content = Buffer.alloc(0);
            }
        }

        zipFiles.push([dirPrefix + dataName, content]);
        const childPrefix = dirName ? dirPrefix + dirName + "/" : dirPrefix;

        const attrs = [];
        let pos = 10;
        // Every TAM-managed note carries a permanent #TAMFILEID label
        // ("{addonId}/{localId}") -- its sole identity mechanism.
        attrs.push({
            type: "label", name: "TAMFILEID",
            value: `${fullManifest.id || ""}/${localId}`,
            isInheritable: false, position: pos,
        });
        pos += 10;

        for (const lbl of noteLabels[localId] || []) {
            attrs.push({
                type: "label", name: lbl.name, value: lbl.value || "",
                isInheritable: false, position: pos,
            });
            pos += 10;
        }

        for (const rel of noteRelations[localId] || []) {
            const target = uuidMap[rel.to] ?? rel.to;
            attrs.push({
                type: "relation", name: rel.type, value: target,
                isInheritable: false, position: pos,
            });
            pos += 10;
        }

        // A Trilium ZIP import walks physical file entries; an isClone meta
        // entry with no backing file is never visited. Mirror Trilium's own
        // exporter: write an empty placeholder file for every clone.
        function cloneEntry(noteId, cloneNotePath, position) {
            const cloneName = uniqueBase(childPrefix, "clone") + ".html";
            zipFiles.push([childPrefix + cloneName, Buffer.alloc(0)]);
            return {
                isClone: true, noteId, notePath: cloneNotePath,
                notePosition: position, prefix: null, isExpanded: false,
                dataFileName: cloneName,
            };
        }

        const childEntries = [];
        let i = 1;
        for (const [childLid, isCloneRef] of localChildren) {
            if (isCloneRef) {
                childEntries.push(cloneEntry(uuidMap[childLid], [...currentPath, uuidMap[childLid]], i * 10));
            } else {
                childEntries.push(await buildEntry(childLid, i * 10, childPrefix, currentPath));
            }
            i++;
        }

        const entry = {
            isClone: false, noteId: noteUuid, notePath: currentPath,
            title, notePosition: notePosition, prefix: null,
            isExpanded: hasChildren, type: noteType, mime: noteMime,
            attributes: attrs, attachments: [], dataFileName: dataName,
        };
        if (dirName) entry.dirFileName = dirName;
        if (childEntries.length) entry.children = childEntries;
        if (noteType === "text") {
            entry.format = noteMime === "text/markdown" ? "markdown" : "html";
        }
        return entry;
    }

    const rootEntry = await buildEntry(rootLid, 10, "", []);
    if (!("dirFileName" in rootEntry)) {
        rootEntry.dirFileName = safeName(notesById[rootLid].title);
    }
    return { rootEntry, zipFiles, warnings, uuidMap };
}


async function buildZip(manifestPath, outPath) {
    if (!exists(manifestPath)) {
        die(`ERROR: ${manifestPath} not found`);
    }

    const addonDir = path.dirname(manifestPath);
    const fullManifest = JSON.parse(readText(manifestPath));
    if (outPath == null) {
        outPath = path.join(addonDir, `${fullManifest.id || "export"}.zip`);
    }

    const m = fullManifest.manifest;
    if (!m) {
        die("ERROR: no 'manifest' key -- metadata-only addons cannot be exported as a Trilium ZIP");
    }
    if (!m.root && !(m.children || []).some((c) => c.parent === "root")) {
        die("ERROR: manifest.children must attach at least one note to the reserved \"root\" parent");
    }

    const { rootEntry, zipFiles, warnings } = await processManifest(fullManifest);

    const triliumMeta = {
        formatVersion: 2, appVersion: TRILIUM_APP_VERSION,
        files: [rootEntry],
    };

    writeZip(outPath, [
        ["!!!meta.json", Buffer.from(jsonDumps(triliumMeta, 2))],
        ...zipFiles,
    ]);

    if (warnings.length) {
        console.log("Warnings:");
        for (const w of warnings) console.log(`  ${w}`);
    }

    console.log(`Written: ${outPath}  (${zipFiles.length} content files)`);
}


async function cmdTamToZip(args) {
    if (args.all) {
        if (args.manifest || args.out) {
            die("ERROR: --all cannot be combined with a manifest path or --out");
        }
        const addonsDir = args.addonsDir || "addons";
        const outDir = args.outDir || ".";

        const manifestPaths = iterManifests(addonsDir);
        if (!manifestPaths.length) {
            die(`ERROR: no ${MANIFEST_NAME} files found under ${addonsDir}`);
        }
        for (const manifestPath of manifestPaths) {
            const addonId = JSON.parse(readText(manifestPath)).id || "export";
            await buildZip(manifestPath, path.join(outDir, `${addonId}.zip`));
        }
        return;
    }

    if (!args.manifest) {
        die("ERROR: manifest is required unless --all is given");
    }
    let manifestPath = args.manifest;
    if (isDir(manifestPath)) {
        manifestPath = path.join(manifestPath, MANIFEST_NAME);
    }
    await buildZip(manifestPath, args.out || null);
}


// ===========================================================================
// zip-to-tam
// ===========================================================================

function slugify(title) {
    const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "note";
}


function assignIds(filesArray, idMap, seenIds) {
    // First pass: assign a stable local id to every noteId in the tree.
    for (const entry of filesArray) {
        const noteId = entry.noteId;
        if (noteId == null) continue; // noImport scaffold entry
        if (!(noteId in idMap)) {
            idMap[noteId] = uniqueName(slugify(entry.title || "note"), seenIds);
        }
        assignIds(entry.children || [], idMap, seenIds);
    }
}


function* walkEntries(filesArray, parentLocalId, idMap, dirPrefix = "") {
    // Second pass: yield [entry, localId, parentLocalId, isClone, dirPrefix] in tree order.
    for (const entry of filesArray) {
        const noteId = entry.noteId;
        if (noteId == null) continue;
        const localId = idMap[noteId];
        yield [entry, localId, parentLocalId, Boolean(entry.isClone), dirPrefix];
        const childPrefix = entry.dirFileName ? dirPrefix + entry.dirFileName + "/" : dirPrefix;
        yield* walkEntries(entry.children || [], localId, idMap, childPrefix);
    }
}


function cmdZipToTam(args) {
    const inputPath = args.input;
    const outDir = args.out;
    if (!exists(inputPath)) {
        die(`ERROR: ${inputPath} not found`);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const tmppath = fs.mkdtempSync(path.join(os.tmpdir(), "ziptotam-"));
    try {
        const extracted = extractZip(inputPath, tmppath);

        const metaFiles = Object.keys(extracted).filter((p) => path.basename(p) === "!!!meta.json").sort();
        if (!metaFiles.length) {
            die("ERROR: no !!!meta.json found in ZIP");
        }
        const metaFile = metaFiles[0];
        const metaRoot = path.dirname(metaFile);
        const meta = JSON.parse(extracted[metaFile].toString("utf8"));

        const filesArray = (meta.files || []).filter((f) => !f.noImport);
        if (!filesArray.length) {
            die("ERROR: !!!meta.json has no 'files' array");
        }

        const idMap = {}, seenIds = new Set();
        assignIds(filesArray, idMap, seenIds);
        const rootLocalId = idMap[filesArray[0].noteId];

        // Every other manifest's sourceUrl is absolute (see lib-tam.js's resolveNotes) --
        // scaffold the same shape here whenever the manifest's own future URL is
        // knowable; only fall back to a bare relative filename if it isn't.
        const manifestSourceUrl = detectManifestSourceUrl(outDir);

        const notes = [], children = [], relations = [], labels = [];
        const usedFilenames = new Set();

        const byBasename = {};
        for (const p of Object.keys(extracted)) {
            (byBasename[path.basename(p)] ||= []).push(p);
        }
        const metaPrefix = (metaRoot && metaRoot !== ".") ? metaRoot + "/" : "";

        for (const [entry, localId, parentLocalId, isClone, dirPrefix] of walkEntries(filesArray, null, idMap)) {
            // The ZIP's own top-level note becomes the reserved "root" parent keyword instead
            // of a real notes[] entry -- TAM synthesizes this note itself for every addon but
            // TAM (see lib-tam.js's ensureAddonAnchor). Rewrite its direct children's parent to
            // "root" and drop the note itself (and any labels/relations declared on it).
            const effectiveParentLocalId = parentLocalId === rootLocalId ? "root" : parentLocalId;
            if (localId === rootLocalId) continue;

            if (isClone) {
                if (effectiveParentLocalId) {
                    children.push({ parent: effectiveParentLocalId, child: localId });
                }
                continue;
            }

            const noteType = entry.type || "text";
            const dataFile = entry.dataFileName;

            let sourceUrl = null;
            if (dataFile && !dataFile.endsWith(".clone.html")) {
                let dataKey = metaPrefix + dirPrefix + dataFile;
                if (!(dataKey in extracted)) {
                    const flat = metaPrefix + dataFile;
                    dataKey = (flat in extracted) ? flat
                        : ((byBasename[path.basename(dataFile)] || [])[0] || null);
                }
                if (dataKey && dataKey in extracted) {
                    const destName = uniqueName(dataFile, usedFilenames);
                    fs.writeFileSync(path.join(outDir, destName), extracted[dataKey]);
                    sourceUrl = manifestSourceUrl ? new URL(destName, manifestSourceUrl).href : destName;
                }
            }

            const mime = entry.mime ||
                (dataFile ? (EXT_TO_MIME[suffixOf(dataFile).toLowerCase()] || "text/plain") : "text/html");
            const note = {
                id: localId, title: entry.title || localId,
                type: noteType, mime, sourceUrl,
            };
            if (noteType === "file") note.binary = true;
            notes.push(note);

            if (effectiveParentLocalId) {
                children.push({ parent: effectiveParentLocalId, child: localId });
            }

            for (const attr of entry.attributes || []) {
                if (attr.type === "label") {
                    labels.push({ note: localId, name: attr.name || "", value: attr.value || "" });
                } else if (attr.type === "relation") {
                    relations.push({
                        from: localId, type: attr.name || "",
                        to: idMap[attr.value] ?? (attr.value || ""),
                    });
                }
            }
        }

        const manifest = {
            id: "FILL_IN", name: "FILL_IN", description: "FILL_IN",
            author: "FILL_IN", homepage: "FILL_IN", license: "GPL-3.0-or-later",
            latestVersion: "1.0.0", type: "widget", readme: "README.md",
            ...(manifestSourceUrl ? { manifestSourceUrl } : {}),
            manifest: {
                notes, children, relations, labels,
            },
        };
        const outputFile = path.join(outDir, MANIFEST_NAME);
        writeText(outputFile, jsonDumps(manifest, 2));

        console.log(`Written: ${outputFile}`);
        console.log(`  ${notes.length} notes, ${children.length} children, ${relations.length} relations, ${labels.length} labels`);
        console.log("  Search for '\"FILL_IN\"' in _tam_manifest_.json and replace with real values");
        if (manifestSourceUrl) {
            console.log(`  manifestSourceUrl auto-detected: ${manifestSourceUrl}`);
        } else {
            console.log("  manifestSourceUrl NOT set (not inside a git repo with a github.com origin) -- fill in by hand before publishing");
        }
    } finally {
        fs.rmSync(tmppath, { recursive: true, force: true });
    }
}


// ===========================================================================
// generate-pages / generate-readme (shared addon rendering)
// ===========================================================================

let renderMd;
try {
    const { marked } = require("marked");
    marked.setOptions({ gfm: true });
    // Match python-markdown's `toc` extension: every heading gets an id slug
    // (lowercase, non-word/space/hyphen stripped, spaces -> '-') so in-README
    // anchor links keep working. Uniquified per document, as toc does. Done as
    // an output post-pass -- marked v12's object-literal renderer override
    // doesn't get `this.parser` bound, so building the id inline isn't reliable.
    const slugify = (headingHtml, seen) => {
        const plain = headingHtml.replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        let slug = plain.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
        if (!slug) slug = "section";
        if (seen.has(slug)) {
            const n = seen.get(slug) + 1;
            seen.set(slug, n);
            return `${slug}_${n}`;
        }
        seen.set(slug, 0);
        return slug;
    };
    renderMd = (text) => {
        const seen = new Map();
        return marked.parse(text).replace(
            /<h([1-6])>([\s\S]*?)<\/h\1>/g,
            (_, level, inner) => `<h${level} id="${slugify(inner, seen)}">${inner}</h${level}>`
        );
    };
} catch {
    renderMd = (text) => `<pre>${text}</pre>`;
}

const REPO = "https://github.com/BeatLink/trilium-scripts";
const RELEASES = `${REPO}/releases/latest`;
const PAGES_URL = "https://beatlink.github.io/trilium-scripts/";
const CATALOG_URL = `${PAGES_URL}catalog.json`;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const TYPE_COLORS = {
    widget: "#2563eb", theme: "#7c3aed", css: "#059669",
    script: "#d97706", library: "#0891b2", template: "#be185d",
};


function badge(t) {
    return `<span class="badge" style="background:${TYPE_COLORS[t] || "#6b7280"}">${htmlEscape(t)}</span>`;
}


function page(baseHtml, title, body, css = "style.css") {
    return baseHtml
        .split("{{TITLE}}").join(htmlEscape(title))
        .split("{{CSS}}").join(css)
        .split("{{BODY}}").join(body)
        .split("{{REPO}}").join(REPO);
}


function renderIndex(baseHtml, addons) {
    const typesPresent = [...new Set(addons.map((a) => a.meta.type).filter(Boolean))].sort();

    const cards = [];
    for (const a of addons) {
        const m = a.meta;
        const aid = m.id, t = m.type || "";
        const name = m.name || aid, desc = m.description || "";
        const author = m.author || "", version = m.latestVersion || "";
        cards.push(`  <a class="card" href="${htmlEscape(aid)}/" data-type="${htmlEscape(t)}" data-name="${htmlEscape(name.toLowerCase())}" data-desc="${htmlEscape(desc.toLowerCase())}">
    <div class="card-top">
      <span class="card-name">${htmlEscape(name)}</span>
      ${badge(t)}
    </div>
    <p class="card-desc">${htmlEscape(desc)}</p>
    <div class="card-foot">
      <span>v${htmlEscape(version)}</span>
      <span class="card-author" data-author="${htmlEscape(author)}">${htmlEscape(author)}</span>
    </div>
  </a>`);
    }

    const filterBtns = ['<button class="filter active" data-type="all" style="--c:#2563eb">All</button>'];
    for (const t of typesPresent) {
        const color = TYPE_COLORS[t] || "#2563eb";
        const title = t.charAt(0).toUpperCase() + t.slice(1);
        filterBtns.push(`<button class="filter" data-type="${t}" style="--c:${color}">${title}</button>`);
    }

    const body = `<header>
  <div class="hdr">
    <div class="hdr-left">
      <h1>Trilium Addons</h1>
      <p>${addons.length} addons for <a href="https://github.com/TriliumNext/Notes" target="_blank">TriliumNext Notes</a></p>
    </div>
    <div class="hdr-right">
      <div class="tam-box">
        <span class="tam-label">Add as a Trilium Addon Manager catalog</span>
        <code class="tam-url">${CATALOG_URL}</code>
      </div>
      <div class="hdr-links">
        <a href="${REPO}" target="_blank">GitHub</a>
        <a href="${RELEASES}" target="_blank">Releases</a>
      </div>
    </div>
  </div>
</header>
<main>
  <div class="toolbar">
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Search addons…" autocomplete="off" spellcheck="false">
    </div>
    <div class="filters">
      ${filterBtns.join(" ")}
    </div>
  </div>
  <div class="grid">
${cards.join("\n")}
  </div>
</main>
<script>
(function() {
  var s = document.getElementById('search');
  var btns = document.querySelectorAll('.filter');
  var cards = document.querySelectorAll('.card');
  var activeType = 'all';
  function run() {
    var q = s.value.trim().toLowerCase();
    cards.forEach(function(c) {
      var ok = (activeType === 'all' || c.dataset.type === activeType) &&
               (!q || c.dataset.name.includes(q) || c.dataset.desc.includes(q));
      c.style.display = ok ? '' : 'none';
    });
  }
  s.addEventListener('input', run);
  btns.forEach(function(b) {
    b.addEventListener('click', function() {
      btns.forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active');
      activeType = b.dataset.type;
      run();
    });
  });
  document.querySelectorAll('.card-author').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.open('https://github.com/' + el.dataset.author, '_blank');
    });
  });
})();
</script>`;
    return page(baseHtml, "Trilium Addons — BeatLink", body);
}


function renderAddon(baseHtml, meta, readmeHtml) {
    const aid = meta.id;
    const name = meta.name || aid;
    const version = meta.latestVersion || "—";
    const author = meta.author || "—";
    const lic = meta.license || "—";
    const t = meta.type || "";
    const hp = meta.homepage || "";
    const zipUrl = `${RELEASES}/download/${aid}.zip`;
    const manifestUrl = meta.manifestSourceUrl || "";

    const authorDisplay = (author && author !== "—")
        ? `<a href="https://github.com/${htmlEscape(author)}" target="_blank">${htmlEscape(author)}</a>`
        : htmlEscape(author);

    const rows = [
        ["ID", `<code>${htmlEscape(aid)}</code>`],
        ["Version", htmlEscape(version)],
        ["Author", authorDisplay],
        ["License", htmlEscape(lic)],
        ["Type", htmlEscape(t)],
    ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");

    let actions = `<a class="btn" href="${htmlEscape(zipUrl)}">Download ZIP</a>`;
    if (manifestUrl) {
        actions += `\n      <a class="btn btn-ghost" href="${htmlEscape(manifestUrl)}" target="_blank">View Manifest</a>`;
    }
    if (hp) {
        actions += `\n      <a class="btn btn-ghost" href="${htmlEscape(hp)}" target="_blank">Source</a>`;
    }

    const content = readmeHtml
        ? `<div class="readme">${readmeHtml}</div>`
        : '<p class="no-readme">No README available.</p>';

    const body = `<header>
  <div class="hdr">
    <a class="back" href="../">← All Addons</a>
    <div class="hdr-name">
      <h1>${htmlEscape(name)}</h1>
      ${badge(t)}
    </div>
  </div>
</header>
<main>
  <div class="addon-layout">
    <aside class="addon-sidebar">
      <table class="meta-table">${rows}</table>
      <div class="addon-actions">
      ${actions}
      </div>
    </aside>
    <div class="addon-content">
      ${content}
    </div>
  </div>
</main>`;
    return page(baseHtml, `${name} — Trilium Addons`, body, "../style.css");
}


function cmdGeneratePages(args) {
    const staticDir = path.join(path.dirname(path.dirname(path.resolve(__filename))), "static", "pages");
    const baseHtml = readText(path.join(staticDir, "base.html"));
    const css = readText(path.join(staticDir, "style.css"));

    const docsDir = "docs";
    fs.mkdirSync(docsDir, { recursive: true });

    const addons = loadAddons();

    for (const a of addons) {
        const aid = a.meta.id;
        const pageDir = path.join(docsDir, aid);
        fs.mkdirSync(pageDir, { recursive: true });
        for (const f of fs.readdirSync(a.outerDir)) {
            const full = path.join(a.outerDir, f);
            if (fs.statSync(full).isFile() && IMAGE_EXTS.has(suffixOf(f).toLowerCase())) {
                fs.copyFileSync(full, path.join(pageDir, f));
            }
        }
        writeText(path.join(pageDir, "index.html"), renderAddon(baseHtml, a.meta, a.readmeHtml));
    }

    writeText(path.join(docsDir, "index.html"), renderIndex(baseHtml, addons));
    writeText(path.join(docsDir, "style.css"), css);
    console.log(`Generated docs/ for ${addons.length} addons`);

    const urls = addons.filter((a) => a.meta.manifestSourceUrl).map((a) => a.meta.manifestSourceUrl);
    const missing = addons.length - urls.length;
    writeText(path.join(docsDir, "catalog.json"),
        jsonDumps({ webUrl: PAGES_URL, "tam-addons": urls }, 2) + "\n");
    console.log(`Generated docs/catalog.json with ${urls.length} addon(s)` +
        (missing ? ` (${missing} skipped -- no manifestSourceUrl)` : ""));
}


const README_START = "<!-- GENERATED:START -->";
const README_END = "<!-- GENERATED:END -->";


function cmdGenerateReadme(args) {
    const basePath = "README_base.md";
    if (!exists(basePath)) {
        console.log("WARNING: README_base.md not found -- skipping README generation");
        return;
    }
    const base = readText(basePath);

    const addons = loadAddons();
    const sorted = [...addons].sort((a, b) =>
        (a.meta.name || a.meta.id).toLowerCase().localeCompare((b.meta.name || b.meta.id).toLowerCase()));
    const rows = [];
    for (const a of sorted) {
        const m = a.meta;
        const name = m.name || m.id;
        const t = m.type || "";
        // Escape raw HTML (GitHub embeds it) and markdown table pipes.
        const desc = htmlEscape((m.description || "").split("\n")[0]).replace(/\|/g, "\\|");
        const ver = m.latestVersion || "";
        rows.push(`| [${name}](addons/${path.basename(a.outerDir)}/) | ${t} | ${desc} | ${ver} |`);
    }

    const table = [
        "| Name | Type | Description | Version |",
        "|------|------|-------------|---------|",
        ...rows,
    ].join("\n");

    const startIdx = base.indexOf(README_START), endIdx = base.indexOf(README_END);
    if (startIdx === -1 || endIdx === -1) {
        console.log("WARNING: README_base.md missing GENERATED markers -- skipping README generation");
        return;
    }
    const afterStart = startIdx + README_START.length;
    writeText("README.md", base.slice(0, afterStart) + "\n" + table + "\n" + base.slice(endIdx));
    console.log(`Generated README.md with ${rows.length} addons`);
}


// ===========================================================================
// publish-release
// ===========================================================================

function cmdPublishRelease(args) {
    const sha = process.env.GITHUB_SHA || "unknown";
    const runNumber = process.env.GITHUB_RUN_NUMBER || "0";

    const files = fs.readdirSync(".").filter((f) => f.endsWith(".zip")).sort();
    if (!files.length) {
        die("No *.zip files found to upload");
    }

    const notes = `Auto-published from \`${sha}\``;

    function publishTo(tag, title, latest) {
        // `create` fails whenever the release already exists — always true for the
        // floating `latest` tag after the first publish, and true for
        // `publish-<run>` on a re-run. That is expected, so its failure is not
        // fatal; but every *other* create failure (bad token, missing permission)
        // must not fall through to `upload`, which would then fail with the far
        // more confusing "release not found". So: tolerate the already-exists
        // case by confirming the release is really there, and surface anything
        // else with the actual stderr rather than discarding it.
        const created = spawnSync("gh", [
            "release", "create", tag, "--title", title, "--notes", notes,
            ...(latest ? ["--latest"] : []),
        ], { encoding: "utf8" });

        if (created.status !== 0) {
            const view = spawnSync("gh", ["release", "view", tag], { stdio: "ignore" });
            if (view.status !== 0) {
                process.stderr.write(created.stderr || "");
                die(`Could not create or find release '${tag}'`);
            }
        }

        const r = spawnSync("gh", ["release", "upload", tag, ...files, "--clobber"], { stdio: "inherit" });
        if (r.status !== 0) process.exit(r.status || 1);
    }

    // A permanently-addressable release for this exact publish (older-version
    // path), plus the floating 'latest' alias every "download current" link uses.
    publishTo(`publish-${runNumber}`, `Publish ${runNumber}`, false);
    publishTo("latest", "Latest", true);
}


// ===========================================================================
// backfill-source-url
// ===========================================================================

function cmdBackfillSourceUrl(args) {
    if (!isDir("addons")) {
        die("ERROR: no 'addons/' directory -- run from repo root");
    }

    let updated = 0, skipped = 0;
    for (const manifestFile of iterManifests()) {
        const url = detectManifestSourceUrl(path.dirname(manifestFile));
        if (!url) {
            console.log(`SKIP  ${manifestFile}: not detectable (no git repo / no github.com origin)`);
            skipped++;
            continue;
        }

        const manifest = JSON.parse(readText(manifestFile));
        if (manifest.manifestSourceUrl === url) {
            continue;
        }

        // Place manifestSourceUrl right after "readme" (or at the end),
        // matching where zip-to-tam puts it -- cosmetic, keeps manifests uniform.
        const newManifest = {};
        let inserted = false;
        for (const [key, value] of Object.entries(manifest)) {
            newManifest[key] = value;
            if (key === "readme") {
                newManifest.manifestSourceUrl = url;
                inserted = true;
            }
        }
        if (!inserted) {
            newManifest.manifestSourceUrl = url;
        }

        writeText(manifestFile, jsonDumps(newManifest, 4) + "\n");
        console.log(`SET   ${manifestFile}: ${url}`);
        updated++;
    }

    console.log(`\n${updated} manifest(s) updated, ${skipped} skipped`);
}


// ===========================================================================
// Minimal ZIP reader/writer (stdlib zlib only, no npm dependency)
// ===========================================================================

const zlib = require("zlib");

// CRC-32 table
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}


function writeZip(outPath, entries) {
    // entries: [ [name, Buffer], ... ]. Deflate-compressed, matching what
    // Trilium's importer expects (Python used ZIP_DEFLATED).
    const localParts = [];
    const central = [];
    let offset = 0;

    for (const [name, contentRaw] of entries) {
        const content = Buffer.isBuffer(contentRaw) ? contentRaw : Buffer.from(contentRaw);
        const nameBuf = Buffer.from(name, "utf8");
        const crc = crc32(content);
        const compressed = zlib.deflateRawSync(content);
        const useStore = compressed.length >= content.length;
        const method = useStore ? 0 : 8;
        const data = useStore ? content : compressed;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 filenames
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);          // mod time
        local.writeUInt16LE(0x21, 12);       // mod date
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);          // extra len

        localParts.push(local, nameBuf, data);

        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);            // version made by
        cen.writeUInt16LE(20, 6);            // version needed
        cen.writeUInt16LE(0x0800, 8);        // flags
        cen.writeUInt16LE(method, 10);
        cen.writeUInt16LE(0, 12);            // mod time
        cen.writeUInt16LE(0x21, 14);         // mod date
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(data.length, 20);
        cen.writeUInt32LE(content.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt16LE(0, 30);            // extra len
        cen.writeUInt16LE(0, 32);            // comment len
        cen.writeUInt16LE(0, 34);            // disk number
        cen.writeUInt16LE(0, 36);            // internal attrs
        cen.writeUInt32LE(0, 38);            // external attrs
        cen.writeUInt32LE(offset, 42);       // local header offset
        central.push(Buffer.concat([cen, nameBuf]));

        offset += local.length + nameBuf.length + data.length;
    }

    const centralBuf = Buffer.concat(central);
    const localBuf = Buffer.concat(localParts);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(localBuf.length, 16);
    eocd.writeUInt16LE(0, 20);

    fs.writeFileSync(outPath, Buffer.concat([localBuf, centralBuf, eocd]));
}


function extractZip(zipPath, destDir) {
    // Returns { "posix/rel/path": Buffer } for every file entry, and also
    // writes nothing to disk beyond destDir tracking (kept in-memory). The
    // returned keys are relative to destDir using forward slashes, matching
    // how the caller builds metaRoot-based lookups.
    const buf = fs.readFileSync(zipPath);
    const result = {};

    // Locate End Of Central Directory record (search from the end).
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) die(`ERROR: ${zipPath} is not a valid ZIP (no EOCD)`);

    const total = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16); // central dir offset

    for (let n = 0; n < total; n++) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
        const method = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 20);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const localOffset = buf.readUInt32LE(ptr + 42);
        const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
        ptr += 46 + nameLen + extraLen + commentLen;

        if (name.endsWith("/")) continue; // directory entry

        // Read the local header to find where the data starts.
        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const compData = buf.subarray(dataStart, dataStart + compSize);
        const content = method === 0 ? Buffer.from(compData) : zlib.inflateRawSync(compData);

        result[name] = content;
    }
    return result;
}


// ===========================================================================
// CLI
// ===========================================================================

function parseArgs(argv) {
    // Minimal argparse-shaped parser: pulls out flags, leaves positionals.
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--fix") args.fix = true;
        else if (a === "--all") args.all = true;
        else if (a === "--out") args.out = argv[++i];
        else if (a === "--out-dir") args.outDir = argv[++i];
        else if (a === "--addons-dir") args.addonsDir = argv[++i];
        else if (a.startsWith("--out=")) args.out = a.slice(6);
        else if (a.startsWith("--out-dir=")) args.outDir = a.slice(10);
        else if (a.startsWith("--addons-dir=")) args.addonsDir = a.slice(13);
        else if (a === "-h" || a === "--help") args.help = true;
        else args._.push(a);
    }
    return args;
}

const USAGE = `usage: tamhelper.js <command> [options]

TAM addon toolchain -- validate, build, and publish addons.

commands:
  validate [--fix]                          Lint every addon manifest
  tam-to-zip [manifest] [--out F] [--addons-dir D] [--all] [--out-dir D]
  zip-to-tam <input.zip> [--out DIR]        Convert a Trilium ZIP to a manifest
  generate-pages                            Build the GitHub Pages site (docs/)
  generate-readme                           Regenerate README.md's addon table
  publish-release                           Upload *.zip files to GitHub Releases
  backfill-source-url                       Add manifestSourceUrl where missing
`;

async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const args = parseArgs(argv.slice(1));

    switch (command) {
        case "validate":
            await cmdValidate(args);
            break;
        case "tam-to-zip":
            args.manifest = args._[0];
            await cmdTamToZip(args);
            break;
        case "zip-to-tam":
            if (!args._[0]) die("ERROR: input ZIP is required");
            args.input = args._[0];
            args.out = args.out || ".";
            cmdZipToTam(args);
            break;
        case "generate-pages":
            cmdGeneratePages(args);
            break;
        case "generate-readme":
            cmdGenerateReadme(args);
            break;
        case "publish-release":
            cmdPublishRelease(args);
            break;
        case "backfill-source-url":
            cmdBackfillSourceUrl(args);
            break;
        case undefined:
        case "-h":
        case "--help":
            process.stdout.write(USAGE);
            break;
        default:
            process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
            process.exit(2);
    }
}

main().catch((e) => die(`ERROR: ${e.message}`));
