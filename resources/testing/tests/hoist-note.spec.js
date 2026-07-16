"use strict";
/* End-to-end test for hoist-note@beatlink.

Installs the addon the way a user does -- through TAM's own UI, from the local
addon server (installViaTam: Settings -> Install by URL -> Enable Addon ->
reload). No ZIP import. Then asserts, in one suite off that single install:

  Deployment (backend, tri, via ETAPI):
    - both scripts imported as frontend code notes
    - setupButtons.js carries ~hoistNoteScript -> hoistNote.js
    - #run=frontendStartup is live (NOT under the disabled: prefix -- proves the
      Enable step actually flipped it)

  Behaviour (frontend, page):
    - setupButtons.js ran at startup and created the "Hoist Note" launchbar button
    - clicking it toggles hoisting onto the current note and back to root

Install happens once in beforeAll (it persists in the shared server); every
test reads that same state.
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

const ADDON_ID = "hoist-note@beatlink";

test.beforeAll(async ({ browser }) => {
    // beforeAll has no `page` fixture, so drive install on a throwaway page.
    const raw = await browser.newPage();
    try {
        await installViaTam(wrapPage(raw), httpClient(), ADDON_ID);
    } finally {
        await raw.close();
    }
});

// ---- Deployment (backend) -------------------------------------------------

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
    const target = await tri.getNote(rel.value);
    expect(target.title).toBe("hoistNote.js");
});

test("setupButtons #run=frontendStartup is live after enable", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'setupButtons.js'");
    const setup = await tri.getNote(results[0].noteId);
    const attrs = setup.attributes || [];

    const run = attrs.find((a) => a.type === "label" && a.name === "run");
    expect(run, "setupButtons.js is missing a live #run label (still disabled?)").toBeTruthy();
    expect(run.value).toBe("frontendStartup");
    // The Enable step must have removed the disabled: shadow.
    expect(attrs.some((a) => a.name === "disabled:run")).toBe(false);
});

// ---- Behaviour (frontend) -------------------------------------------------

// The launchbar button setupButtons.js creates (title "Hoist Note", bx-pin icon).
function hoistLauncher(page) {
    return page.getByRole("button", { name: /Hoist Note/i })
        .or(page.locator("[title='Hoist Note'], .launcher-button:has-text('Hoist Note')"))
        .first();
}

test("frontend startup created the Hoist Note launchbar button", async ({ page }) => {
    await page.gotoNote("root");
    await expect(hoistLauncher(page)).toBeVisible({ timeout: 20_000 });
});

test("clicking the launcher toggles hoisting on and off", async ({ tri, page }) => {
    // Hoist onto a note that's always present and has children so the tree
    // visibly changes -- TAM's own root.
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    const targetId = results[0].noteId;

    await page.gotoNote(targetId);
    const launcher = hoistLauncher(page);
    await expect(launcher).toBeVisible({ timeout: 20_000 });

    // hoistNote.js drives api.getActiveContext().hoistedNoteId / setHoistedNoteId;
    // read that same state via Trilium's frontend global (window.glob).
    const hoistedNoteId = () =>
        page.evaluate(() =>
            window.glob?.appContext?.tabManager?.getActiveContext?.()?.hoistedNoteId ?? null
        );

    await launcher.click();
    await expect.poll(hoistedNoteId, { timeout: 15_000 }).toBe(targetId);

    await launcher.click();
    await expect.poll(hoistedNoteId, { timeout: 15_000 }).toBe("root");
});
