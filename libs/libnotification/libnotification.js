// Sends a desktop notification that navigates to a note when clicked
async function sendNotification(title, body, noteId) {
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
}

module.exports = { sendNotification };
