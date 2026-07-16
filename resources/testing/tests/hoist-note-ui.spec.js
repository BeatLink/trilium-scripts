"use strict";
/* Browser-driven test for hoist-note@beatlink.

Two things only a real frontend can exercise:

  1. setupButtons.js is a #run=frontendStartup script -- it only fires when a
     browser actually loads the Trilium frontend. It creates the launchbar
     button (api.createOrUpdateLauncher). So we load the app, then assert the
     "Hoist Note" launcher exists.
  2. hoistNote.js toggles api.setHoistedNoteId between the current note and
     'root'. We click the launcher on a note and assert the tree hoists, click
     again and assert it un-hoists.

hoist-note isn't in the golden seed, so we install it first (installAddon =
tam-to-zip + notes-import). The frontend must reload AFTER install for the
startup script to pick up the new note.
*/

const path = require("path");
const { test, expect } = require("../testing");

const ADDON_DIR = path.resolve(__dirname, "..", "..", "..", "addons", "hoist-note@beatlink");

// The launchbar button setupButtons.js creates: title "Hoist Note", bx-pin
// icon. Match on the title text within a launcher/button role so it doesn't
// collide with a note that happens to share the words.
function hoistLauncher(page) {
    return page.getByRole("button", { name: /Hoist Note/i })
        .or(page.locator("[title='Hoist Note'], .launcher-button:has-text('Hoist Note')"))
        .first();
}

// beforeAll runs before any test-scoped fixture (tri) exists, so build a
// throwaway http client here to do the one-time install.
test.beforeAll(async () => {
    const { httpClient } = require("../testing");
    await httpClient().installAddon(ADDON_DIR);
});

test("frontend startup creates the Hoist Note launchbar button", async ({ page }) => {
    // Load any note so the frontend boots and runs #run=frontendStartup scripts.
    await page.gotoNote("root");
    // The startup script runs api.runOnBackend to create the launcher; give the
    // launchbar a moment to reflect it, reloading once if needed.
    const launcher = hoistLauncher(page);
    if (await launcher.count() === 0) {
        await page.reload({ waitUntil: "networkidle" });
    }
    await expect(hoistLauncher(page)).toBeVisible({ timeout: 20_000 });
});

test("clicking the launcher toggles hoisting on and off", async ({ tri, page }) => {
    // Pick a concrete note to hoist onto -- one of TAM's own notes is always
    // present in the seed and has children, so hoisting visibly changes the tree.
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    const targetId = results[0].noteId;

    await page.gotoNote(targetId);
    const launcher = hoistLauncher(page);
    await expect(launcher).toBeVisible({ timeout: 20_000 });

    // Read the active context's hoistedNoteId directly from the frontend api.
    // hoistNote.js drives exactly api.getActiveContext().hoistedNoteId /
    // setHoistedNoteId, so this is the state it mutates. glob.appContext is
    // Trilium's frontend entry point (window.glob is the documented global).
    const hoistedNoteId = () =>
        page.evaluate(() =>
            window.glob?.appContext?.tabManager?.getActiveContext?.()?.hoistedNoteId ?? null
        );

    // Hoist onto the target.
    await launcher.click();
    await expect.poll(hoistedNoteId, { timeout: 15_000 }).toBe(targetId);

    // Toggle back to root.
    await launcher.click();
    await expect.poll(hoistedNoteId, { timeout: 15_000 }).toBe("root");
});
