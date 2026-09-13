/* no-drop-expand@beatlink — startup

Stops the note tree from opening folders after a note is dropped into one.

After every tree reload Trilium brings the active note back into view. When the note you just
dragged is the active one and it lands inside a collapsed folder, that reveal opens every folder
above it and saves each one to the database, so they are still open after a restart. Two separate
pieces of Trilium do it: NoteTreeWidget.expandToNote(), and Fancytree's activeVisible option, which
expands the ancestors of whatever node is made active.

This script watches for drops on the tree and turns both off for a moment afterwards. The note you
moved still becomes the active note, it just stops pulling folders open on its way.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
*/

// How long after a drop the reveal stays blocked, in milliseconds.
const GRACE_MS = 2000;

let blockedUntil = 0;

function isBlocked() {
    return Date.now() < blockedUntil;
}

// Runs a tree method with Fancytree's reveal-the-active-node expansion switched off.
function withoutActiveVisible(widget, run) {
    if (!isBlocked() || !widget.tree) return run();

    const previous = widget.tree.options.activeVisible;
    widget.tree.options.activeVisible = false;
    return Promise.resolve(run()).finally(() => {
        widget.tree.options.activeVisible = previous;
    });
}

// Patched on the prototype so every note tree is covered, including the ones popups create later.
function patchNoteTree(widget) {
    const proto = Object.getPrototypeOf(widget);
    if (proto.noDropExpandPatched) return;
    proto.noDropExpandPatched = true;

    const expandToNote = proto.expandToNote;
    proto.expandToNote = function (notePath, logErrors = true) {
        // The same lookup without the expand flag still finds the note, it just leaves the folders closed.
        if (isBlocked()) return this.getNodeFromPath(notePath, false, logErrors);
        return expandToNote.call(this, notePath, logErrors);
    };

    // The two methods that reactivate the note after the tree changes.
    for (const name of ["entitiesReloadedEvent", "refresh"]) {
        const original = proto[name];
        proto[name] = function (...args) {
            return withoutActiveVisible(this, () => original.apply(this, args));
        };
    }
}

// Capture phase, so the window opens before Fancytree starts moving the branch.
document.addEventListener("drop", (event) => {
    const container = event.target.closest?.("ul.fancytree-container");
    if (!container) return;

    blockedUntil = Date.now() + GRACE_MS;

    const widget = api.getComponentByEl(container);
    if (widget && typeof widget.expandToNote === "function") patchNoteTree(widget);
}, true);
