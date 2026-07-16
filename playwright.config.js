"use strict";
/* The single entry point for the Trilium test system.

`playwright test` (the `run_tests` shell function in flake.nix) is the whole
flow: globalSetup seeds the golden snapshot if it's missing + boots
trilium-server with TAM deployed; the `tri`/`page` fixtures hand each test a
Trilium-aware page + no-auth http client; globalTeardown stops the server. All
of that glue lives in resources/testing/testing.js -- this file only wires it
into Playwright.

Everything below `trilium-server`/`$TRILIUM_SRC` (both from `nix develop`) is
provided by this repo's own flake -- no separate setup, no `playwright install`.
*/

const { defineConfig } = require("@playwright/test");
const { BASE_URL } = require("./resources/testing/testing");

module.exports = defineConfig({
    testDir: "./resources/testing/tests",
    // The seeded server is a single shared instance -- tests drive one real
    // Trilium, so run them serially rather than fighting over its state.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
    // testing.js's default export is globalSetup; it returns the teardown fn,
    // which Playwright runs as global teardown -- so no separate globalTeardown.
    globalSetup: require.resolve("./resources/testing/testing"),
    // Boot + TAM import can be slow the first time (seed builds the snapshot).
    timeout: 60_000,
    use: {
        baseURL: BASE_URL,
        headless: false,
        launchOptions: { args: ["--no-sandbox"] },
        trace: "retain-on-failure",
    },
});
