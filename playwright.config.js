"use strict";
/* The single entry point for the Trilium test system.

`playwright test` (the `test` shell function in flake.nix) is the whole flow:
globalSetup seeds the golden snapshot if it's missing + boots trilium-server
with TAM deployed; the `trilium` fixture (fixtures.js) hands each test a
Trilium-aware page + no-auth http client; globalTeardown stops the server.

Everything below `trilium-server`/`$TRILIUM_SRC` (both from `nix develop`) is
provided by this repo's own flake -- no separate setup, no `playwright install`.
*/

const { defineConfig } = require("@playwright/test");
const { BASE_URL } = require("./resources/testing/harness");

module.exports = defineConfig({
    testDir: "./resources/testing/tests",
    // The seeded server is a single shared instance -- tests drive one real
    // Trilium, so run them serially rather than fighting over its state.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
    globalSetup: require.resolve("./resources/testing/global-setup"),
    globalTeardown: require.resolve("./resources/testing/global-teardown"),
    // Boot + TAM import can be slow the first time (seed builds the snapshot).
    timeout: 60_000,
    use: {
        baseURL: BASE_URL,
        headless: true,
        launchOptions: { args: ["--no-sandbox"] },
        trace: "retain-on-failure",
    },
});
