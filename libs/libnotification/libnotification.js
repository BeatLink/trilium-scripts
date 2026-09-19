// Sends a desktop notification that navigates to a note when clicked
// requireInteraction keeps the notification on screen until it is dismissed
async function sendNotification(title, body, noteId, requireInteraction = false) {
    let notification = new window.Notification(
        title,
        {
            body: body,
            icon: "icon.png",
            requireInteraction: requireInteraction,
            tag: "trilium-notifications"
        }
    );
    notification.onclick = (event) => {
        event.preventDefault();
        api.activateNote(noteId);
    };
}

module.exports = { sendNotification };
