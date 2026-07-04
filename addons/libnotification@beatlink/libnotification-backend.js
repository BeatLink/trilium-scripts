// Backend-callable variant: the Notification API only exists in the frontend,
// so this hops over via a self-contained runOnFrontend closure (no outer
// references — same convention as every other runOnBackend/runOnFrontend call
// in this repo) rather than requiring the caller to manage that hop itself.
function sendNotification(title, body, noteId) {
    api.runOnFrontend((title, body, noteId) => {
        let notification = new window.Notification(
            title,
            {
                body: body,
                icon: "icon.png",
                tag: "trilium-notifications"
            }
        );
        notification.onclick = (event) => {
            event.preventDefault();
            api.activateNote(noteId);
        };
    }, [title, body, noteId])
}

module.exports = { sendNotification }
