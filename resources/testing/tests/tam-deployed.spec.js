"use strict";
/* Backend smoke test: the seeded snapshot has TAM deployed.

Locates TAM's notes via ETAPI search (a plain no-auth GET -- no browser, no
/api/script/exec anchor note needed). The seed imports TAM via its tam-to-zip
ZIP, which carries the #TAMFILEID labels TAM's resolver applies, so both the
render root and the tagged notes are findable straight after import.
*/

const { test, expect } = require("../testing");

test("TAM render root is deployed in the seed", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("render");
});

test("TAM's #TAMFILEID-tagged notes are present", async ({ tri }) => {
    const { results } = await tri.searchNotes("#TAMFILEID");
    expect(results.length).toBeGreaterThan(0);
});

test("TAM's shared library note is present", async ({ tri }) => {
    // lib-tam.js is the one code note TAM.jsx require()s -- if the ZIP import
    // dropped clone/child wiring it would be missing (the tam-to-zip
    // clone-placeholder bug the harness README documents).
    const { results } = await tri.searchNotes("note.title = 'lib-tam.js'");
    expect(results.length).toBeGreaterThan(0);
});
