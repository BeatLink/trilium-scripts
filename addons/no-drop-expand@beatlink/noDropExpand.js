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

The tree also keeps the open note visible: entitiesReloadedEvent ends in #setActiveNode(), which
expands every folder on the way down to it. Dropping the note you are reading would therefore open
the folder a second time, and again on every later refresh. So when the dragged note is the active
one, the tree is moved to a note that stays put first: the next sibling of where it was dragged
from, else the previous one, else its old parent.

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

// The branch IDs being dragged, from the JSON the tree puts on the drag in dragStart().
function getDraggedBranchIds(event) {
    try {
        return new Set(JSON.parse(event.dataTransfer.getData("text")).map((note) => note.branchId));
    } catch (e) {
        return new Set();
    }
}

// The node to sit on once this one has been dragged away: a sibling staying behind, else the parent.
function replacementFor(node, draggedBranchIds) {
    for (const step of ["getNextSibling", "getPrevSibling"]) {
        for (let sibling = node[step](); sibling; sibling = sibling[step]()) {
            if (!draggedBranchIds.has(sibling.data.branchId)) return sibling;
        }
    }

    const parent = node.getParent();
    return parent?.data?.noteId ? parent : null;
}

// Moves the tree off the dragged note, so nothing has to expand the folder to show it again.
function moveActiveNoteOut(widget, draggedBranchIds) {
    let dragged = widget.getActiveNode();
    while (dragged && !draggedBranchIds.has(dragged.data.branchId)) dragged = dragged.getParent();
    if (!dragged) return;

    replacementFor(dragged, draggedBranchIds)?.setActive(true);
}

// Capture phase, so the folder is read while it is still closed and still carries its drop classes.
document.addEventListener("drop", (event) => {
    const container = event.target.closest?.("ul.fancytree-container");
    if (!container) return;

    // getNode() only unwraps jQuery events, so hand it the element from this native one.
    const node = $.ui.fancytree.getNode(event.target);
    if (!node || node.isExpanded()) return;

    // fancytree-drop-accept means the drop lands inside the note; before and after only reorder.
    if (!node.span?.classList.contains("fancytree-drop-accept")) return;

    remember(node.data.branchId);

    const widget = api.getComponentByEl(container);
    if (!widget || typeof widget.updateNode !== "function") return;

    patchNoteTree(widget);
    moveActiveNoteOut(widget, getDraggedBranchIds(event));
}, true);
