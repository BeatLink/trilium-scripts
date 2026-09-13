"use strict";
/* End-to-end test for area-picker@beatlink.

Installs the addon through TAM's own UI from the local addon server
(installViaTam: Settings -> Install by URL -> Enable Addon -> reload) -- the
same path a user takes, no ZIP import. area-picker depends on
libsettings@beatlink, and its manifest wires an `AddonData:config` relation from
its settings note to config.json, so this single install also exercises TAM's
persistence connect (see tam-persistence.spec.js for that mechanism in detail).

Asserts, off that one install:

  Deployment (backend, tri, via ETAPI):
    - the widget script imported as a frontend (JSX) code note with #widget live
      (NOT under the disabled: prefix -- proves Enable flipped it)
    - schema.json / config.json imported as JSON code notes
    - the widget carries #widget and its schemaNote/settingsNote relations
    - libsettings landed as a dependency (libSettingsUI.jsx present)

  Behaviour (frontend, page):
    - the widget mounts on a note that has an #area label (its visibility gate)
    - picking an area from the dropdown writes the note's #area label; picking
      "None" clears it

Install happens once in beforeAll (it persists in the shared server); every
test reads that same state.
*/

const { test, expect, installViaTam } = require("../testing");
const { httpClient, wrapPage } = require("../testing");

const ADDON_ID = "area-picker@beatlink";

// installViaTam confirms the install by waiting for the addon's OWN root note,
// but a dependency (libsettings) is fetched and wired separately and can lag a
// beat behind. Poll ETAPI until the dependency's note is present so the tests
// below don't race a half-settled install.
async function waitForNote(tri, query, { timeoutMs = 30_000, everyMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { results } = await tri.searchNotes(query);
        if (results && results.length > 0) return results;
        if (Date.now() > deadline) return [];
        await new Promise((r) => setTimeout(r, everyMs));
    }
}

test.beforeAll(async ({ browser }) => {
    // Installing through TAM's UI is several navigations, and this addon pulls
    // in libsettings as a dependency -- give the hook well over the default 60s.
    test.setTimeout(180_000);
    const tri = httpClient();
    const raw = await browser.newPage();
    try {
        // Install FROM the local catalog (installViaTam's default mode). area-picker
        // declares libsettings as a bare-id dependency, which TAM only resolves when
        // installing from a catalog (a bare id is looked up against the catalog's
        // addon list) -- an install-by-URL carries no catalog context and would
        // leave the dependency missing. This is the real user path for a dependent
        // addon, and it pulls libsettings in for free.
        await installViaTam(wrapPage(raw), tri, ADDON_ID);
    } finally {
        await raw.close();
    }
    // area-picker's widget/settings both require("libSettingsUI.jsx") -- the
    // libsettings `ui` export. TAM resolves only the closure an addon actually
    // references, so this (not the unused backend `libSettings.js`) is what must
    // land. If it didn't, the widget's require() is broken (TAM didn't resolve
    // the dependency on install).
    const dep = await waitForNote(tri, "note.title = 'libSettingsUI.jsx'");
    expect(dep.length, "libsettings ui export (libSettingsUI.jsx) never landed -- TAM did not resolve area-picker's dependency on install").toBeGreaterThan(0);
});

// ---- Deployment (backend) -------------------------------------------------

test("widget script imported as a frontend JSX code note", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'areaPickerPreact'");
    expect(results.length).toBeGreaterThan(0);
    const note = await tri.getNote(results[0].noteId);
    expect(note.type).toBe("code");
    expect(note.mime).toBe("text/jsx");
});

test("schema.json imported as a JSON code note", async ({ tri }) => {
    // schema.json is a normal shipped note (not AddonData-tracked), so it stays
    // in the addon's tree under #TAMFILEID.
    const { results } = await tri.searchNotes("note.title = 'schema.json' AND #TAMFILEID");
    expect(results.length, "schema.json not imported").toBeGreaterThan(0);
    const note = await tri.getNote(results[0].noteId);
    expect(note.type).toBe("code");
    expect(note.mime).toBe("application/json");
});

test("config.json is the persisted #TAMFILEID copy", async ({ tri }) => {
    // config.json is parented on the reserved "persistence" keyword, so TAM
    // resolves it as an ordinary #TAMFILEID note anchored under the shared
    // "Addon Data" note. The older #TAMDATAID namespace is gone.
    // (tam-persistence.spec.js exercises this mechanism in full.)
    const { results: persisted } = await tri.searchNotes(
        "note.title = 'config.json' AND #TAMFILEID = 'area-picker@beatlink/config'");
    expect(persisted.length, "no config.json tagged #TAMFILEID=area-picker@beatlink/config").toBe(1);
    const { results: legacy } = await tri.searchNotes("#TAMDATAID");
    expect(legacy.length, "#TAMDATAID is a removed namespace but a note still carries it").toBe(0);
});

test("widget #widget label is live after enable", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'areaPickerPreact'");
    const script = await tri.getNote(results[0].noteId);
    const attrs = script.attributes || [];
    expect(attrs.some((a) => a.type === "label" && a.name === "widget"),
        "areaPickerPreact is missing a live #widget label (still disabled?)").toBe(true);
    // The Enable step must have removed the disabled: shadow.
    expect(attrs.some((a) => a.name === "disabled:widget")).toBe(false);
});

test("widget carries schemaNote and settingsNote relations", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'areaPickerPreact'");
    const script = await tri.getNote(results[0].noteId);
    const rels = (script.attributes || []).filter((a) => a.type === "relation");
    for (const name of ["schemaNote", "settingsNote"]) {
        const rel = rels.find((r) => r.name === name);
        expect(rel, `areaPickerPreact is missing its ~${name} relation`).toBeTruthy();
        const target = await tri.getNote(rel.value);
        expect(target).toBeTruthy();
    }
});

test("libsettings dependency landed alongside the addon", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'libSettingsUI.jsx'");
    expect(results.length, "libsettings dependency not installed").toBeGreaterThan(0);
});

// ---- Behaviour (frontend) -------------------------------------------------

// The widget renders only when the active note carries the promoted label
// DEFINITION #label:area -- not the #area value (see areaPickerPreact.jsx
// `setVisible`, which reads getLabelValue("label:area")). Normally that
// definition is inherited from a template; here both are set by hand. Pick TAM's
// own root as the target note, tag it, drive the dropdown, then untag it so the
// suite leaves no residue on shared state that later tests read.
async function targetNoteId(tri) {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
    return results[0].noteId;
}

// Label helpers over plain ETAPI (no backend anchor needed -- area-picker
// installs no backend code note, so /api/script/exec has nothing to anchor on).
// A note's labels come back on GET /etapi/notes/{id} as `attributes`.
async function readLabel(tri, noteId, name) {
    const note = await tri.getNote(noteId);
    const a = (note.attributes || []).find((a) => a.type === "label" && a.name === name);
    return a ? a.value : null;
}

async function setLabel(tri, noteId, name, value) {
    // Idempotent: remove any existing same-named label first, then create it.
    await removeLabel(tri, noteId, name);
    await tri.request("POST", "/etapi/attributes", {
        noteId, type: "label", name, value, isInheritable: false,
    });
}

async function removeLabel(tri, noteId, name) {
    const note = await tri.getNote(noteId);
    for (const a of (note.attributes || [])) {
        if (a.type === "label" && a.name === name && a.noteId === noteId) {
            await tri.request("DELETE", `/etapi/attributes/${a.attributeId}`);
        }
    }
}

// FormDropdownList drops the `class` it is handed, so the widget's own
// .dropdown-component class never reaches the DOM: target the bootstrap
// structure it really renders. Its items are li.dropdown-item with no role.
const dropdownToggle = (page) => page.locator("#x-area-picker-widget .dropdown-toggle").first();
const dropdownOption = (page, name) =>
    page.locator("#x-area-picker-widget .dropdown-menu .dropdown-item")
        .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();

// Both labels: the definition makes the widget appear, the value seeds it.
async function tagArea(tri, noteId) {
    await setLabel(tri, noteId, "label:area", "promoted,single,text");
    await setLabel(tri, noteId, "area", "01-career");
}

async function untagArea(tri, noteId) {
    await removeLabel(tri, noteId, "area");
    await removeLabel(tri, noteId, "label:area");
}

test("widget mounts on a note that has an #area label definition", async ({ tri, page }) => {
    const noteId = await targetNoteId(tri);
    await tagArea(tri, noteId);
    try {
        await page.gotoNote(noteId);
        await expect(page.locator("#x-area-picker-widget")).toBeVisible({ timeout: 20_000 });
    } finally {
        await untagArea(tri, noteId);
    }
});

test("picking an area writes the note's #area label, None clears it", async ({ tri, page }) => {
    const noteId = await targetNoteId(tri);
    await tagArea(tri, noteId);
    try {
        await page.gotoNote(noteId);
        const toggle = dropdownToggle(page);
        await expect(toggle).toBeVisible({ timeout: 20_000 });

        // Open the dropdown and pick a different, known-shipped area ("Finances").
        await toggle.click();
        await dropdownOption(page, "Finances").click();
        await expect
            .poll(() => readLabel(tri, noteId, "area"), { timeout: 15_000 })
            .toBe("02-finances");

        // Pick "None" -- the widget removes the label entirely.
        await toggle.click();
        await dropdownOption(page, "None").click();
        await expect
            .poll(() => readLabel(tri, noteId, "area"), { timeout: 15_000 })
            .toBe(null);
    } finally {
        await untagArea(tri, noteId);
    }
});
