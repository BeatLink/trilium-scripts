"use strict";
/* End-to-end test for no-drop-expand@beatlink.

Installs the addon through TAM's own UI, then drags a note onto a collapsed
folder in the real note tree and asserts the folder is still collapsed
afterwards -- both in the DOM and in the database, since the server marks the
target branch expanded on every move and the addon has to write that back.
*/

const { test, expect, installViaTam, httpClient, wrapPage, BASE_URL } = require("../testing");

const ADDON_ID = "no-drop-expand@beatlink";

test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const raw = await browser.newPage();
    try {
        await installViaTam(wrapPage(raw), httpClient(), ADDON_ID, { mode: "url" });
    } finally {
        await raw.close();
    }
});

// Drags the first leaf note onto the first collapsed folder, returning the
// target's branchId plus its expanded state before and after the drop.
async function dragOntoCollapsedFolder(page) {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const picked = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll("span.fancytree-node")];
        const target = nodes.find((n) => n.classList.contains("fancytree-folder") && !n.classList.contains("fancytree-expanded"));
        const source = nodes.find((n) => !n.classList.contains("fancytree-folder") && n !== target);
        if (!target || !source) return null;
        return {
            targetIndex: nodes.indexOf(target),
            sourceIndex: nodes.indexOf(source),
            branchId: window.$.ui.fancytree.getNode(target).data.branchId,
        };
    });
    expect(picked, "seed tree needs a collapsed folder and a leaf note").toBeTruthy();

    const src = page.locator("span.fancytree-node").nth(picked.sourceIndex).locator(".fancytree-title");
    const dst = page.locator("span.fancytree-node").nth(picked.targetIndex).locator(".fancytree-title");
    await src.dragTo(dst);
    await page.waitForTimeout(5000);

    const expandedAfter = await page.evaluate(
        (branchId) => {
            const tree = window.$.ui.fancytree.getTree(window.$(".tree").first());
            const node = tree.getNodeByKey
                ? [...document.querySelectorAll("span.fancytree-node")]
                      .map((el) => window.$.ui.fancytree.getNode(el))
                      .find((n) => n && n.data.branchId === branchId)
                : null;
            return node ? node.isExpanded() : null;
        },
        picked.branchId
    );

    return { ...picked, expandedAfter };
}

test("the drop target stays collapsed in the tree", async ({ page }) => {
    test.setTimeout(180_000);
    const { expandedAfter } = await dragOntoCollapsedFolder(page);
    expect(expandedAfter).toBe(false);
});

test("the collapse is written back to the server", async ({ page, tri }) => {
    test.setTimeout(180_000);
    const { branchId } = await dragOntoCollapsedFolder(page);
    const branch = await tri.request("GET", `/etapi/branches/${branchId}`);
    expect(branch.isExpanded).toBe(false);
});
