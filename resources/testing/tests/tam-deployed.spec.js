"use strict";
/* Backend smoke test: the seeded snapshot has TAM deployed.

Locates TAM's notes via ETAPI search (a plain no-auth GET -- no browser, no
/api/script/exec anchor note needed). The seed imports TAM via its tam-to-zip
ZIP, which carries the #TAMFILEID labels TAM's resolver applies, so both the
render root and the tagged notes are findable straight after import.
*/

const { test, expect } = require("../fixtures");

test("TAM render root is deployed in the seed", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("render");
});

test("TAM's #TAMFILEID-tagged notes are present", async ({ tri }) => {
    const { results } = await tri.searchNotes("#TAMFILEID");
    expect(results.length).toBeGreaterThan(0);
});

test("TAM's shared library notes are present", async ({ tri }) => {
    // A few of the code notes TAM's UI require()s -- if the ZIP import dropped
    // clone/child wiring these would be missing (the tam-to-zip clone-placeholder
    // bug the harness README documents).
    const { results } = await tri.searchNotes("note.title *=* libTAM");
    expect(results.map((n) => n.title)).toContain("libTAMDatabase.js");
});
