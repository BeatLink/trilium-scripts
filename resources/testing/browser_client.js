#!/usr/bin/env node
"use strict";
/* Playwright-driven browser layer on top of the headless trilium_client.js API.

Some things TAM does (fetching a manifest, running `require()`-bundled frontend JSX
widgets, dispatching UI commands) only happen in frontend-env code, which
/api/script/exec can't execute (it only runs backend-env bundles -- see
execScript()'s docstring). To exercise those, drive a real Chromium instance
against the running trilium-server instead.

Usage:
    const { withPage } = require("./browser_client");
    await withPage(async (page) => {
        await page.gotoNote(someNoteId);
        await page.enableRenderNote();  // dismiss the "untrusted render note" warning once
    });
*/

const { chromium } = require("playwright");

const PORT = parseInt(process.env.TRILIUM_TESTING_PORT || "8090", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PLAYWRIGHT_BROWSERS_PATH / PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS are set by
// shell.nix's shellHook (pointing at pkgs.playwright-driver.browsers, matched to the
// pinned `playwright` package's expected browser revision) so `playwright install`
// -- which tries to download into $HOME/.cache and fails offline/in a sandbox -- is
// never needed inside `nix develop`/`nix-shell`.

class TriliumPage {
    // Thin wrapper around a Playwright Page pre-aimed at this trilium-server.
    // Unknown methods/properties fall through to the underlying Page via Proxy.
    constructor(page) {
        this.page = page;
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (prop in target) return Reflect.get(target, prop, receiver);
                const val = target.page[prop];
                return typeof val === "function" ? val.bind(target.page) : val;
            },
        });
    }

    async gotoNote(noteId, waitSeconds = 3) {
        await this.page.goto(`${BASE_URL}/#root/${noteId}`, { waitUntil: "networkidle" });
        await sleep(waitSeconds * 1000);
        return this;
    }

    async enableRenderNote(waitSeconds = 3) {
        // Dismiss the "this render note comes from an external source" trust
        // warning Trilium shows the first time a render-type note is opened.
        // No-op if the note is already trusted (or isn't a render note).
        const btns = this.page.getByRole("button", { name: "Enable render note" });
        if (await btns.count() > 0) {
            await btns.first().click({ force: true });
            await sleep(waitSeconds * 1000);
        }
        return this;
    }
}

async function withPage(fn, { headless = true } = {}) {
    // Runs fn(page) against a fresh Chromium instance. Closes the browser on
    // exit (including on exception).
    const browser = await chromium.launch({ args: ["--no-sandbox"], headless });
    try {
        const page = await browser.newPage();
        return await fn(new TriliumPage(page));
    } finally {
        await browser.close();
    }
}

module.exports = { withPage, TriliumPage, BASE_URL, PORT };
