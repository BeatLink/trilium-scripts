"use strict";
/* Backend test for TAM's persistence mechanism (two-roots / placement model).

A manifest parents a note on the reserved "persistence" keyword to mark it
persistent; expanded@beatlink places its `config` note there. TAM resolves
persistent notes as ordinary #TAMFILEID notes, but anchored under the shared
"Addon Data" note (a stable, TAM-owned anchor the uninstall/prune sweeps skip),
and never overwrites their content on update. So user config survives an update
or an uninstall, and a later reinstall re-adopts the same note by #TAMFILEID.

These tests install expanded@beatlink through TAM's UI and assert the resulting
tree shape over ETAPI + /api/script/exec:

  - the config note is tagged #TAMFILEID="expanded@beatlink/config"
  - it is NOT tagged #TAMDATAID (that namespace is gone)
  - it lives under the "Addon Data" subtree
  - settings.jsx's ~configNote relation points at it
  - a write to it is what loadSettings reads back (it's live config)
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

// expanded is the subject because it both persists a config note and ships the
// backend libSettings.js that execScript has to anchor on.
const ADDON_ID = "expanded@beatlink";
const FILE_ID = `${ADDON_ID}/config`;
// Several installed addons ship a settings.jsx, so find this one by its own
// #TAMFILEID rather than by title.
const SETTINGS_FILE_ID = `${ADDON_ID}/settings`;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const raw = await browser.newPage();
    try {
        // url mode: expanded has no bare-id dependencies, and a catalog card is
        // matched on substring, which "Expanded" shares with other addons' text.
        await installViaTam(wrapPage(raw), httpClient(), ADDON_ID, { mode: "url" });
    } finally {
        await raw.close();
    }
});

// execScript needs a backend/code note as its startNoteId anchor. libSettings.js
// (expanded's backend-env dependency, installed above) is that note.
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

    const target = await runBackend(tri, `(settingsFileId) => {
        const settings = api.getNoteWithLabel("TAMFILEID", settingsFileId);
        if (!settings) return null;
        return settings.getRelationValue("configNote");
    }`, [SETTINGS_FILE_ID]);
    expect(target, "settings.jsx has no ~configNote relation").toBeTruthy();
    expect(target).toBe(info.noteId);
});

test("a write to the config note is the live config the addon reads back", async ({ tri }) => {
    const info = await configNoteInfo(tri);
    expect(info).toBeTruthy();

    const readBack = await runBackend(tri, `(fileId, settingsFileId) => {
        const config = api.getNoteWithLabel("TAMFILEID", fileId);
        config.setContent(JSON.stringify({ theme: "sentinel-value" }));

        const settings = api.getNoteWithLabel("TAMFILEID", settingsFileId);
        const configNoteId = settings.getRelationValue("configNote");
        return JSON.parse(api.getNote(configNoteId).getContent() || "{}").theme;
    }`, [FILE_ID, SETTINGS_FILE_ID]);
    expect(readBack).toBe("sentinel-value");
});
