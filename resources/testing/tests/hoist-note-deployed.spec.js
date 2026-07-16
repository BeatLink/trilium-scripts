"use strict";
/* Backend deployment test for hoist-note@beatlink.

hoist-note isn't in the golden seed (only TAM is), so this installs it first
via tri.installAddon() -- tam-to-zip + notes-import, the same path seed() uses
for TAM -- then inspects the result through plain ETAPI (no browser).

What it guards: that the manifest's wiring survives a real ZIP import. The
harness README documents a whole bug class here -- tam-to-zip once silently
dropped clone/relation wiring, so notes imported but the ~hoistNoteScript
relation and #run label that make the addon actually *do* anything went
missing. These assertions fail loudly if that regresses.
*/

const path = require("path");
const { test, expect } = require("../testing");

const ADDON_DIR = path.resolve(__dirname, "..", "..", "..", "addons", "hoist-note@beatlink");

// Install once for the whole file. installAddon is idempotent enough for a
// single suite run against the fresh per-run snapshot (see harness prepare()).
test.beforeAll(async () => {
    const { httpClient } = require("../testing");
    await httpClient().installAddon(ADDON_DIR);
});

test("both script notes are imported as frontend code notes", async ({ tri }) => {
    for (const title of ["setupButtons.js", "hoistNote.js"]) {
        const { results } = await tri.searchNotes(`note.title = '${title}'`);
        expect(results.length).toBeGreaterThan(0);
        const note = await tri.getNote(results[0].noteId);
        expect(note.type).toBe("code");
        expect(note.mime).toBe("application/javascript;env=frontend");
    }
});

test("setupButtons carries the ~hoistNoteScript relation to hoistNote", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'setupButtons.js'");
    const setup = await tri.getNote(results[0].noteId);

    const rel = (setup.attributes || []).find(
        (a) => a.type === "relation" && a.name === "hoistNoteScript"
    );
    expect(rel, "setupButtons.js is missing its ~hoistNoteScript relation").toBeTruthy();

    // The relation must point at the actual hoistNote.js note -- a dropped
    // clone/target would leave the launcher button wired to nothing.
    const target = await tri.getNote(rel.value);
    expect(target.title).toBe("hoistNote.js");
});

test("setupButtons is labelled to run at frontend startup", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'setupButtons.js'");
    const setup = await tri.getNote(results[0].noteId);

    const run = (setup.attributes || []).find(
        (a) => a.type === "label" && a.name === "run"
    );
    expect(run, "setupButtons.js is missing its #run label").toBeTruthy();
    expect(run.value).toBe("frontendStartup");
});
