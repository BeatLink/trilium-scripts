"use strict";
/* Browser-driven test: TAM's frontend widget mounts and renders.

TAM's UI (TAM.jsx et al.) is a frontend-env render note -- /api/script/exec
can't run it (backend only), so this drives a real Chromium against the running
server. Exercises the path the backend smoke test can't: the render note
actually loading its require()-bundled JSX and painting.
*/

const { test, expect } = require("../fixtures");

test("TAM UI mounts when its render note is opened", async ({ tri, page }) => {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    const tamNoteId = results[0].noteId;

    await page.gotoNote(tamNoteId);
    await page.enableRenderNote();

    // TAM's manager UI exposes tabs/sections ("Installed", "Catalog",
    // "Settings"). Assert at least one of its own controls painted, scoped to
    // visible elements so it doesn't match the note tree's own titles.
    const control = page
        .locator(".note-detail-render :visible")
        .filter({ hasText: /Installed|Catalog|Settings/ })
        .first();
    await expect(control).toBeVisible({ timeout: 20_000 });
});
