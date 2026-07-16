"use strict";
/* Backend test for TAM's persistence mechanism (AddonData: notes).

When an addon manifest declares an `AddonData:<key>` relation from one of its
notes to a shipped note (area-picker@beatlink wires `settings.jsx
--AddonData:config--> config.json`), TAM's `connectAddonPersistence` (lib-tam.js)
makes a FULL, independent copy of that shipped note under the "Addon Data"
subtree, tags the copy with its own `#TAMDATAID = "<addonId>/<key>"`, rewires the
relation to point at the copy, and deletes the shipped origin. The copy lives in
a DIFFERENT label namespace from `#TAMFILEID`, so no uninstall/prune sweep (all
of which scan by #TAMFILEID) can ever delete it -- that is what lets user config
survive an addon update or reinstall.

These tests install area-picker@beatlink through TAM's UI (which runs
connectAddonPersistence as part of install) and then assert the resulting tree
shape over ETAPI + /api/script/exec:

  - a persisted config note tagged #TAMDATAID="area-picker@beatlink/config" exists
  - it is NOT tagged #TAMFILEID (out of reach of uninstall/prune sweeps)
  - it lives under the "Addon Data" subtree, not under the addon's own tree
  - settings.jsx's ~AddonData:config relation points AT that persisted note
  - the shipped-origin config note (the one the manifest imported into the addon
    tree) was deleted, so the relation can't be dangling at a stale copy
  - a write to the persisted note is what loadSettings reads back (it's live config)
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

// area-picker is the addon-under-test here purely because it declares an
// AddonData: relation; installing it is what exercises the persistence code.
const ADDON_ID = "area-picker@beatlink";
const DATA_ID = `${ADDON_ID}/config`;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const raw = await browser.newPage();
    try {
        await installViaTam(wrapPage(raw), httpClient(), ADDON_ID);
    } finally {
        await raw.close();
    }
});

// execScript needs a backend/code note as its startNoteId anchor. libSettings.js
// (area-picker's backend-env dependency, installed above) is that note.
let anchorNoteId = null;
async function backendAnchor(tri) {
    if (anchorNoteId) return anchorNoteId;
    const { results } = await tri.searchNotes("note.title = 'libSettings.js'");
    expect(results.length, "libSettings.js not installed -- can't anchor execScript").toBeGreaterThan(0);
    anchorNoteId = results[0].noteId;
    return anchorNoteId;
}

// /api/script/exec returns { executionResult, success, ... } -- unwrap to the
// script's own return value.
async function runBackend(tri, script, params) {
    const res = await tri.execScript(script, params, await backendAnchor(tri));
    expect(res.success, `backend script failed: ${JSON.stringify(res.executionResult)}`).toBe(true);
    return res.executionResult;
}

// Read the persisted note's identity + placement in one backend call: its id,
// its #TAMDATAID / #TAMFILEID label values, and the titles of its ancestors (so
// we can assert it sits under "Addon Data").
async function persistedNoteInfo(tri) {
    return runBackend(tri, `(dataId) => {
        const note = api.getNoteWithLabel("TAMDATAID", dataId);
        if (!note) return null;
        const ancestors = [];
        let cur = note;
        const seen = new Set();
        while (cur && !seen.has(cur.noteId)) {
            seen.add(cur.noteId);
            const parents = cur.getParentNotes();
            cur = parents[0];
            if (cur) ancestors.push(cur.title);
        }
        return {
            noteId: note.noteId,
            title: note.title,
            tamDataId: note.getLabelValue("TAMDATAID"),
            tamFileId: note.getLabelValue("TAMFILEID"),
            ancestors,
        };
    }`, [DATA_ID]);
}

test("a persisted config note tagged #TAMDATAID exists after install", async ({ tri }) => {
    const info = await persistedNoteInfo(tri);
    expect(info, `no note tagged #TAMDATAID=${DATA_ID} -- persistence didn't connect`).toBeTruthy();
    expect(info.tamDataId).toBe(DATA_ID);
});

test("the persisted note is NOT tagged #TAMFILEID (safe from uninstall sweeps)", async ({ tri }) => {
    const info = await persistedNoteInfo(tri);
    expect(info).toBeTruthy();
    // #TAMFILEID would make an uninstall/prune sweep delete user config.
    expect(info.tamFileId).toBeFalsy();
});

test("the persisted note lives under the 'Addon Data' subtree", async ({ tri }) => {
    const info = await persistedNoteInfo(tri);
    expect(info).toBeTruthy();
    expect(info.ancestors).toContain("Addon Data");
});

test("settings.jsx's ~AddonData:config points at the persisted note", async ({ tri }) => {
    const info = await persistedNoteInfo(tri);
    expect(info).toBeTruthy();

    const target = await runBackend(tri, `() => {
        const settings = api.searchForNotes("note.title = 'settings.jsx' AND #TAMFILEID")[0];
        if (!settings) return null;
        const rel = settings.getRelations().find(r => r.name === "AddonData:config");
        return rel ? rel.value : null;
    }`, []);
    expect(target, "settings.jsx has no ~AddonData:config relation").toBeTruthy();
    expect(target).toBe(info.noteId);
});

test("the shipped-origin config note was deleted (relation can't dangle)", async ({ tri }) => {
    // After connect, the only config.json note reachable inside the addon's OWN
    // tree (#TAMFILEID namespace) should be gone -- the live one is the #TAMDATAID
    // copy under Addon Data. If a #TAMFILEID-tagged config.json survived, the
    // origin wasn't deleted and the persistence rewire is half-done.
    const originCount = await runBackend(tri, `(addonId) => {
        return api.searchForNotes(\`note.title = 'config.json' AND #TAMFILEID = '\${addonId}/config'\`).length;
    }`, [ADDON_ID]);
    expect(originCount).toBe(0);
});

test("a write to the persisted note is the live config the addon reads back", async ({ tri }) => {
    const info = await persistedNoteInfo(tri);
    expect(info).toBeTruthy();

    // Write a sentinel into the persisted config, then read it back through the
    // same relation the widget resolves (settings.jsx --AddonData:config-->).
    const readBack = await runBackend(tri, `(dataId) => {
        const persisted = api.getNoteWithLabel("TAMDATAID", dataId);
        persisted.setContent(JSON.stringify({ theme: "sentinel-value" }));

        const settings = api.searchForNotes("note.title = 'settings.jsx' AND #TAMFILEID")[0];
        const configNoteId = settings.getRelationValue("AddonData:config");
        return JSON.parse(api.getNote(configNoteId).getContent() || "{}").theme;
    }`, [DATA_ID]);
    expect(readBack).toBe("sentinel-value");
});
