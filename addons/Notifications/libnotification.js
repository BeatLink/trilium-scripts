// sendNotification ----------------------------------------------------------------------------
// Sends a notification to desktop
async function sendNotification(title, body, noteId){
    let notification = new window.Notification(
        title, 
        {
            icon: "icon.png", 
            tag: "trilium-notifications"
        }
    );
    notification.onclick = (event) => {
        event.preventDefault(); // prevent the browser from focusing the Notification's tab
        api.activateNote(noteId)
    };
}

module.exports.sendNotification = sendNotification