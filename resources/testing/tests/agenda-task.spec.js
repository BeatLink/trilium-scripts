"use strict";
/* End-to-end test for agenda-task@beatlink's multi-note editing.

Installs the addon through TAM's own UI from the local catalog (installViaTam:
Settings -> Install -> Enable Addon -> reload), the same path a user takes, then
drives the Task pane against two purpose-made task notes:

  - the pane mounts on a note carrying #agendaTaskWidget, titled plain "Task"
  - alt-clicking both tasks in the tree retitles it "Task (2 notes)"
  - picking a duration writes #duration to both of them
  - a note in the selection that isn't a task is dropped, not written to
*/

const { test, expect, installViaTam, httpClient, wrapPage } = require("../testing");

const ADDON_ID = "agenda-task@beatlink";

async function waitForNote(tri, query, { timeoutMs = 30_000, everyMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { results } = await tri.searchNotes(query);
        if (results && results.length > 0) return results;
        if (Date.now() > deadline) return [];
        await new Promise((r) => setTimeout(r, everyMs));
    }
}

async function createNote(tri, title) {
    const { note } = await tri.request("POST", "/etapi/create-note", {
        parentNoteId: "root", title, type: "text", content: ""
    });
    return note.noteId;
}

async function setLabel(tri, noteId, name, value) {
    await tri.request("POST", "/etapi/attributes", {
        noteId, type: "label", name, value, isInheritable: false
    });
}

async function readLabel(tri, noteId, name) {
    const note = await tri.getNote(noteId);
    const attr = (note.attributes || []).find((a) => a.type === "label" && a.name === name);
    return attr ? attr.value : null;
}

async function deleteNote(tri, noteId) {
    await tri.request("DELETE", `/etapi/notes/${noteId}`);
}

const treeNode = (page, title) =>
    page.locator(".fancytree-title").filter({ hasText: new RegExp(`^${title}$`) }).first();
const paneTitle = (page) => page.locator(".card-header-title").filter({ hasText: /^Task/ }).first();
const durationToggle = (page) => page.locator(".agenda-task-widget .dropdown-toggle").first();
const durationOption = (page, name) =>
    page.locator(".agenda-task-widget .dropdown-menu .dropdown-item")
        .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();

test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const tri = httpClient();
    const raw = await browser.newPage();
    try {
        await installViaTam(wrapPage(raw), tri, ADDON_ID);
    } finally {
        await raw.close();
    }
    const dep = await waitForNote(tri, "note.title = 'libSettingsUI.jsx'");
    expect(dep.length, "libsettings dependency never landed").toBeGreaterThan(0);
});

test("the pane edits a whole tree selection of tasks at once", async ({ tri, page }) => {
    test.setTimeout(120_000);
    const taskOne = await createNote(tri, "ZzTaskOne");
    const taskTwo = await createNote(tri, "ZzTaskTwo");
    const plain = await createNote(tri, "ZzPlainNote");
    await setLabel(tri, taskOne, "agendaTaskWidget", "");
    await setLabel(tri, taskTwo, "agendaTaskWidget", "");

    try {
        await page.gotoNote(taskOne);
        await expect(page.locator(".agenda-task-widget")).toBeVisible({ timeout: 20_000 });
        await expect(paneTitle(page)).toHaveText("Task");

        // Alt-click is Trilium's own multi-select gesture; the plain note joins
        // the selection to prove it is dropped rather than written to.
        await treeNode(page, "ZzTaskOne").click({ modifiers: ["Alt"] });
        await treeNode(page, "ZzTaskTwo").click({ modifiers: ["Alt"] });
        await treeNode(page, "ZzPlainNote").click({ modifiers: ["Alt"] });
        await expect(paneTitle(page)).toHaveText("Task (2 notes)", { timeout: 20_000 });

        await durationToggle(page).click();
        await durationOption(page, "30 Minutes").click();

        await expect.poll(() => readLabel(tri, taskOne, "duration"), { timeout: 20_000 }).toBe("PT30M");
        await expect.poll(() => readLabel(tri, taskTwo, "duration"), { timeout: 20_000 }).toBe("PT30M");
        expect(await readLabel(tri, plain, "duration"), "a non-task note was written to").toBe(null);
    } finally {
        for (const noteId of [taskOne, taskTwo, plain]) await deleteNote(tri, noteId);
    }
});

test("a field whose targets disagree reads Mixed", async ({ tri, page }) => {
    test.setTimeout(120_000);
    const taskOne = await createNote(tri, "ZzMixedOne");
    const taskTwo = await createNote(tri, "ZzMixedTwo");
    await setLabel(tri, taskOne, "agendaTaskWidget", "");
    await setLabel(tri, taskTwo, "agendaTaskWidget", "");
    await setLabel(tri, taskOne, "duration", "PT30M");
    await setLabel(tri, taskTwo, "duration", "PT1H");

    try {
        await page.gotoNote(taskOne);
        await expect(durationToggle(page)).toHaveText("30 Minutes", { timeout: 20_000 });

        await treeNode(page, "ZzMixedOne").click({ modifiers: ["Alt"] });
        await treeNode(page, "ZzMixedTwo").click({ modifiers: ["Alt"] });
        await expect(paneTitle(page)).toHaveText("Task (2 notes)", { timeout: 20_000 });
        await expect(durationToggle(page)).toHaveText("\u2014 Mixed \u2014");

        // Choosing a value settles the disagreement across both of them.
        await durationToggle(page).click();
        await durationOption(page, "15 Minutes").click();
        await expect.poll(() => readLabel(tri, taskOne, "duration"), { timeout: 20_000 }).toBe("PT15M");
        await expect.poll(() => readLabel(tri, taskTwo, "duration"), { timeout: 20_000 }).toBe("PT15M");
    } finally {
        for (const noteId of [taskOne, taskTwo]) await deleteNote(tri, noteId);
    }
});
