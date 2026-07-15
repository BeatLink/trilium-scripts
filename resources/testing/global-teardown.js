"use strict";
/* Playwright globalTeardown: stop the trilium-server started by global-setup.

Set TRILIUM_TESTING_KEEP=1 to leave the server running after the suite (handy
for poking at the same state by hand -- stop it later with
`node resources/testing/harness.js stop`).
*/

const { stop } = require("./harness");

module.exports = async () => {
    if (process.env.TRILIUM_TESTING_KEEP === "1") return;
    await stop();
};
