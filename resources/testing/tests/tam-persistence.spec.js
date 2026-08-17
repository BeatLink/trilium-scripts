"use strict";
/* Backend test for TAM's persistence mechanism (two-roots / placement model).

An addon declares a `persistenceRoot` local id in its manifest; every note under
that subtree is "persistent". area-picker@beatlink places its `config` note under
`persist-root`. TAM resolves persistent notes as ordinary #TAMFILEID notes, but
anchored under the shared "Addon Data" note (a stable, TAM-owned anchor the
uninstall/prune sweeps skip), and never overwrites their content on update. So
user config survives an update or an uninstall, and a later reinstall re-adopts
the same note by #TAMFILEID.

These tests install area-picker@beatlink through TAM's UI and assert the resulting
tree shape over ETAPI + /api/script/exec:

  - the config note is tagged #TAMFILEID="area-picker@beatlink/config"
  - it is NOT tagged #TAMDATAID (that namespace is gone)
  - it lives under the "Addon Data" subtree
  - settings.jsx's ~configNote relation points at it
  - a write to it is what loadSettings reads back (it's live config)
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

const ADDON_ID = "area-picker@beatlink";
const FILE_ID = `${ADDON_ID}/config`;

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

async function runBackend(tri, script, params) {
    const res = await tri.execScript(script, params, await backendAnchor(tri));
    expect(res.success, `backend script failed: ${JSON.stringify(res.executionResult)}`).toBe(true);
    return res.executionResult;
}

// Read the config note's identity + placement in one backend call: its id, its
// #TAMFILEID / #TAMDATAID label values, and the titles of its ancestors (so we can
// assert it sits under "Addon Data").
async function configNoteInfo(tri) {
    return runBackend(tri, `(fileId) => {
        const note = api.getNoteWithLabel("TAMFILEID", fileId);
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
            tamFileId: note.getLabelValue("TAMFILEID"),
            tamDataId: note.getLabelValue("TAMDATAID"),
            ancestors,
        };
    }`, [FILE_ID]);
}

test("the config note is tagged #TAMFILEID after install", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info, `no note tagged #TAMFILEID=${FILE_ID} -- persistent note not resolved`).toBeTruthy();
    expect(info.tamFileId).toBe(FILE_ID);
});

test("the config note is NOT tagged #TAMDATAID (namespace removed)", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info).toBeTruthy();
    expect(info.tamDataId).toBeFalsy();
});

test("the config note lives under the 'Addon Data' subtree", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info).toBeTruthy();
    expect(info.ancestors).toContain("Addon Data");
});

test("settings.jsx's ~configNote points at the config note", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info).toBeTruthy();

    const target = await runBackend(tri, `() => {
        const settings = api.searchForNotes("note.title = 'settings.jsx' AND #TAMFILEID")[0];
        if (!settings) return null;
        return settings.getRelationValue("configNote");
    }`, []);
    expect(target, "settings.jsx has no ~configNote relation").toBeTruthy();
    expect(target).toBe(info.noteId);
});

test("a write to the config note is the live config the addon reads back", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info).toBeTruthy();

    const readBack = await runBackend(tri, `(fileId) => {
        const config = api.getNoteWithLabel("TAMFILEID", fileId);
        config.setContent(JSON.stringify({ theme: "sentinel-value" }));

        const settings = api.searchForNotes("note.title = 'settings.jsx' AND #TAMFILEID")[0];
        const configNoteId = settings.getRelationValue("configNote");
        return JSON.parse(api.getNote(configNoteId).getContent() || "{}").theme;
    }`, [FILE_ID]);
    expect(readBack).toBe("sentinel-value");
});
