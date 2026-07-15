"use strict";
/* Test fixtures. Import `test` and `expect` from here instead of
`@playwright/test` to get Trilium-aware helpers injected:

    const { test, expect } = require("../fixtures");

    test("...", async ({ tri, page }) => {
        const note = await tri.searchNotes("#appCss");
        await page.gotoNote(someNoteId);       // page is already Trilium-wrapped
        await page.enableRenderNote();
    });

  tri   no-auth http client (execScript / importZip / getNote / searchNotes /
        request) against the running test server.
  page  the standard Playwright page, wrapped so gotoNote()/enableRenderNote()
        are available and everything else falls through to the real Page.
*/

const base = require("@playwright/test");
const { httpClient, wrapPage } = require("./harness");

const test = base.test.extend({
    tri: async ({}, use) => {
        await use(httpClient());
    },
    page: async ({ page }, use) => {
        await use(wrapPage(page));
    },
});

module.exports = { test, expect: base.expect };
