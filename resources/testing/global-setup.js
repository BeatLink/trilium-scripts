"use strict";
/* Playwright globalSetup: seed-if-needed + start trilium-server.

Runs once before the whole suite. Delegates to harness.prepare() (which seeds
the golden snapshot when it's missing, or when TRILIUM_TESTING_RESEED=1, then
boots the server). global-teardown.js stops it via harness.stop() (idempotent,
reads the pidfile) rather than a shared handle -- Playwright evaluates setup and
teardown modules independently, so in-memory state doesn't survive between them.
*/

const { prepare, BASE_URL } = require("./harness");

module.exports = async () => {
    await prepare();
    console.log(`Trilium test server ready at ${BASE_URL}/`);
};
