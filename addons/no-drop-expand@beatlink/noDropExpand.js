/* no-drop-expand@beatlink — startup

Stops the note tree from opening a folder when you drop a note into it.

The expansion is decided on the server, not in the browser. Moving a branch into a note runs
moveBranchToBranch() in Trilium's services/branches.ts, which sets isExpanded on the target branch
and saves it, "so that the new placement of the branch is immediately visible". That change comes
back down as an entity change, and NoteTreeWidget.updateNode() syncs the node to the branch's new
isExpanded, which opens the folder. Because the server already wrote it, the folder is still open
after a restart and on every other client.

So there is nothing to prevent, only something to undo. This script notes which folder a drop
landed on while it was still closed, then watches updateNode for that folder opening and closes it
again, writing the collapse back to the server so it does not come back.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
*/

// A drop is forgotten if its entity change has not arrived within this long, in milliseconds.
const GRACE_MS = 5000;

// Branch IDs of folders that were closed when a note was dropped on them.
const droppedOnWhileClosed = new Map();

function remember(branchId) {
    clearTimeout(droppedOnWhileClosed.get(branchId));
    droppedOnWhileClosed.set(branchId, setTimeout(() => droppedOnWhileClosed.delete(branchId), GRACE_MS));
}

function forget(branchId) {
    clearTimeout(droppedOnWhileClosed.get(branchId));
    droppedOnWhileClosed.delete(branchId);
}

// Patched on the prototype so every note tree is covered, including the ones popups create later.
function patchNoteTree(widget) {
    const proto = Object.getPrototypeOf(widget);
    if (proto.noDropExpandPatched) return;
    proto.noDropExpandPatched = true;

    const updateNode = proto.updateNode;
    proto.updateNode = async function (node) {
        const branchId = node.data.branchId;
        if (!droppedOnWhileClosed.has(branchId)) return updateNode.call(this, node);

        const wasExpanded = node.isExpanded();
        const result = await updateNode.call(this, node);

        if (!wasExpanded && node.isExpanded()) {
            forget(branchId);
            // Writes isExpanded back to false in the cache and on the server, undoing the move.
            this.setExpanded(branchId, false);
            await node.setExpanded(false, { noEvents: true, noAnimation: true });
        }

        return result;
    };
}

// Capture phase, so the folder is read while it is still closed.
document.addEventListener("drop", (event) => {
    const container = event.target.closest?.("ul.fancytree-container");
    if (!container) return;

    // getNode() only unwraps jQuery events, so hand it the element from this native one.
    const node = $.ui.fancytree.getNode(event.target);
    if (!node || node.isExpanded()) return;

    remember(node.data.branchId);

    const widget = api.getComponentByEl(container);
    if (widget && typeof widget.updateNode === "function") patchNoteTree(widget);
}, true);
