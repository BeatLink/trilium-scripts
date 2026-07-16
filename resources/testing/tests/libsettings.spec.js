"use strict";
/* Backend test for libsettings@beatlink's persistence/merge engine.

libSettings.js is a stateless, schema-driven settings engine: it merges a
persisted config note against schema defaults (`loadSettings`) and writes back
only the deltas that differ from the shipped defaults (`saveSettings`). The
subtle, easy-to-regress behaviour lives in the `registry` field type -- a
registry's shipped entries live in the schema `default`, and config.json stores
ONLY additions/edits (`entries`) plus deleted shipped ids (`removedIds`), so a
newly-shipped entry reaches existing installs for free and an untouched shipped
entry is never duplicated into config.json.

These tests exercise that engine directly on the backend. libSettings.js is
installed through TAM (so it's a real code note in the tree), then loaded and
evaluated inside a single /api/script/exec call, which hands back its exported
`loadSettings`/`saveSettings` -- no browser needed, the engine is backend JS.
Each case creates its own throwaway schema + config notes, runs the round-trip,
and asserts on both the merged runtime map and the filtered persisted shape.
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

// libsettings is a `library`: it has no runtime toggle and users don't install
// it directly -- it ships as a dependency of the addons that use it. So install
// a real consumer (area-picker) from the local catalog; TAM resolves and
// installs its libsettings dependency, and libSettings.js (the engine under
// test) lands with it.
const HOST_ADDON_ID = "area-picker@beatlink";

async function waitForNote(tri, query, { timeoutMs = 30_000, everyMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { results } = await tri.searchNotes(query);
        if (results && results.length > 0) return results;
        if (Date.now() > deadline) return [];
        await new Promise((r) => setTimeout(r, everyMs));
    }
}

test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const tri = httpClient();
    const raw = await browser.newPage();
    try {
        await installViaTam(wrapPage(raw), tri, HOST_ADDON_ID);
    } finally {
        await raw.close();
    }
    const dep = await waitForNote(tri, "note.title = 'libSettings.js'");
    expect(dep.length, "libSettings.js (the engine under test) never landed").toBeGreaterThan(0);
});

// execScript needs a backend/code note as its startNoteId anchor (the route
// builds the script bundle from it). libSettings.js is that note -- it's the
// backend-env code note this addon installs. Look it up once and reuse it.
let anchorNoteId = null;
async function backendAnchor(tri) {
    if (anchorNoteId) return anchorNoteId;
    const { results } = await tri.searchNotes("note.title = 'libSettings.js'");
    expect(results.length, "libSettings.js not installed -- can't anchor execScript").toBeGreaterThan(0);
    anchorNoteId = results[0].noteId;
    return anchorNoteId;
}

// Run `body` on the backend with libSettings.js's exports in scope. It:
//   1. reads the installed libSettings.js note's source and evaluates it in a
//      fresh CommonJS-style wrapper to recover its `module.exports`
//      (loadSettings/saveSettings) without depending on require()'s note-title
//      resolution (which needs the caller to be anchored under that note),
//   2. creates two throwaway JSON code notes under root -- one schema, one
//      config -- seeded with the caller-supplied JSON,
//   3. invokes `body({ loadSettings, saveSettings, schemaNoteId, configNoteId,
//      readConfig })`, returns its result, then deletes the throwaway notes.
// `body` is stringified and re-parsed on the backend, so it must be
// self-contained (no closure over this file's scope).
async function runWithLib(tri, schemaJson, configJson, body) {
    const anchor = await backendAnchor(tri);
    const script = `(schemaContent, configContent, bodySrc) => {
        const libNote = api.getNoteWithLabel("TAMFILEID", "libsettings@beatlink/backend")
            || api.searchForNotes("note.title = 'libSettings.js'")[0];
        const src = libNote.getContent();
        const module = { exports: {} };
        const factory = new Function("module", "exports", "api", src);
        factory(module, module.exports, api);
        const { loadSettings, saveSettings } = module.exports;

        const schemaNote = api.createTextNote("root", "test-schema", "").note;
        schemaNote.setContent(schemaContent);
        const configNote = api.createTextNote("root", "test-config", "").note;
        configNote.setContent(configContent);
        const schemaNoteId = schemaNote.noteId;
        const configNoteId = configNote.noteId;
        const readConfig = () => JSON.parse(api.getNote(configNoteId).getContent() || "{}");

        try {
            const fn = eval("(" + bodySrc + ")");
            return fn({ loadSettings, saveSettings, schemaNoteId, configNoteId, readConfig });
        } finally {
            api.getNote(schemaNoteId).deleteNote();
            api.getNote(configNoteId).deleteNote();
        }
    }`;
    // /api/script/exec returns { executionResult, success, ... } -- the script's
    // own return value is under executionResult.
    const res = await tri.execScript(script, [
        JSON.stringify(schemaJson),
        JSON.stringify(configJson),
        body.toString(),
    ], anchor);
    expect(res.success, `backend script failed: ${JSON.stringify(res.executionResult)}`).toBe(true);
    return res.executionResult;
}

// A minimal schema mirroring area-picker's shape: a `list` of items plus a
// scalar, and a `registry` with two shipped entries.
const SCHEMA = {
    theme: { type: "string", label: "Theme", default: "light" },
    areas: {
        type: "list",
        label: "Areas",
        default: [{ key: "a", title: "Alpha" }],
        itemSchema: {
            key: { type: "string", label: "Key", default: "" },
            title: { type: "string", label: "Title", default: "" },
        },
    },
    prefixes: {
        type: "registry",
        label: "Prefixes",
        default: {
            "shipped-1": { text: "One" },
            "shipped-2": { text: "Two" },
        },
        itemSchema: {
            text: { type: "string", label: "Text", default: "" },
        },
    },
};

test("loadSettings fills defaults from schema when config is empty", async ({ tri }) => {
    const result = await runWithLib(tri, SCHEMA, {}, ({ loadSettings, schemaNoteId, configNoteId }) => {
        return loadSettings(schemaNoteId, configNoteId);
    });
    expect(result.theme).toBe("light");
    expect(result.areas).toEqual([{ key: "a", title: "Alpha" }]);
    // A registry merges shipped entries into a flat runtime map.
    expect(result.prefixes).toEqual({
        "shipped-1": { text: "One" },
        "shipped-2": { text: "Two" },
    });
});

test("stored scalar overrides the schema default", async ({ tri }) => {
    const result = await runWithLib(tri, SCHEMA, { theme: "dark" }, ({ loadSettings, schemaNoteId, configNoteId }) => {
        return loadSettings(schemaNoteId, configNoteId);
    });
    expect(result.theme).toBe("dark");
});

test("saveSettings persists only deltas that differ from shipped defaults", async ({ tri }) => {
    // Load defaults, change one scalar, save, and read the raw persisted config:
    // an untouched registry must NOT be duplicated into config.json.
    const persisted = await runWithLib(tri, SCHEMA, {}, ({ loadSettings, saveSettings, schemaNoteId, configNoteId, readConfig }) => {
        const values = loadSettings(schemaNoteId, configNoteId);
        values.theme = "dark";
        saveSettings(schemaNoteId, configNoteId, values);
        return readConfig();
    });
    expect(persisted.theme).toBe("dark");
    // Registry entries equal to their shipped baseline are elided.
    expect(persisted.prefixes).toEqual({ entries: {}, removedIds: [] });
});

test("editing a shipped registry entry stores it under entries, keyed by its id", async ({ tri }) => {
    const persisted = await runWithLib(tri, SCHEMA, {}, ({ loadSettings, saveSettings, schemaNoteId, configNoteId, readConfig }) => {
        const values = loadSettings(schemaNoteId, configNoteId);
        values.prefixes["shipped-1"].text = "Edited";
        saveSettings(schemaNoteId, configNoteId, values);
        return readConfig();
    });
    // Only the edited entry is persisted; the untouched one keeps tracking shipped.
    expect(persisted.prefixes.entries).toEqual({ "shipped-1": { text: "Edited" } });
    expect(persisted.prefixes.removedIds).toEqual([]);
});

test("deleting a shipped registry entry records its id in removedIds", async ({ tri }) => {
    const persisted = await runWithLib(tri, SCHEMA, {}, ({ loadSettings, saveSettings, schemaNoteId, configNoteId, readConfig }) => {
        const values = loadSettings(schemaNoteId, configNoteId);
        delete values.prefixes["shipped-2"];
        saveSettings(schemaNoteId, configNoteId, values);
        return readConfig();
    });
    expect(persisted.prefixes.removedIds).toEqual(["shipped-2"]);
    expect(persisted.prefixes.entries).toEqual({});
});

test("a removed shipped entry stays removed across a load/save round-trip", async ({ tri }) => {
    // Persist a removedIds config, then reload: the deleted entry must not
    // reappear from the shipped defaults.
    const config = { prefixes: { entries: {}, removedIds: ["shipped-2"] } };
    const merged = await runWithLib(tri, SCHEMA, config, ({ loadSettings, schemaNoteId, configNoteId }) => {
        return loadSettings(schemaNoteId, configNoteId);
    });
    expect(merged.prefixes).toEqual({ "shipped-1": { text: "One" } });
});

test("a newly-shipped registry entry reaches an existing install for free", async ({ tri }) => {
    // Existing install persisted an edit to shipped-1 before shipped-3 existed.
    // Loading against a schema that now also ships shipped-3 must surface it.
    const grownSchema = JSON.parse(JSON.stringify(SCHEMA));
    grownSchema.prefixes.default["shipped-3"] = { text: "Three" };
    const config = { prefixes: { entries: { "shipped-1": { text: "Edited" } }, removedIds: [] } };
    const merged = await runWithLib(tri, grownSchema, config, ({ loadSettings, schemaNoteId, configNoteId }) => {
        return loadSettings(schemaNoteId, configNoteId);
    });
    expect(merged.prefixes).toEqual({
        "shipped-1": { text: "Edited" },
        "shipped-2": { text: "Two" },
        "shipped-3": { text: "Three" },
    });
});
