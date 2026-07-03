async function send_notification() {

    let enabled = api.currentNote.getLabelValue("enabled")
    let earliest = api.currentNote.getLabelValue("earliest")
    let dateLabel = api.currentNote.getLabelValue("dateLabel")
    let reminderTime = Number(api.currentNote.getLabelValue("reminderTime"))
    
    // Quit if not enabled
    if (enabled != "true") {
    	return;
    }
    
    // Get Notes in the past
    let notes = await api.searchForNotes(`#${dateLabel} != "" AND #${dateLabel} < TODAY+1 orderBy #${dateLabel}`)
    
    
    // Filter out future notes
    
    let now = api.dayjs()
    let filteredNotes = notes.filter((note)=>{
        let date = api.dayjs(note.getLabelValue(dateLabel))
        return (date.isBefore(now, "minute") || date.isSame(now, "minute"))
    })

    // Get the earliest/latest Note
    if (filteredNotes.length > 0) {
        
        let final = filteredNotes[0];
        
        if (filteredNotes.length > 1) {
            final = filteredNotes.reduce(function (a, b) {
                let dateA = dayjs(a.getLabelValue(dateLabel))
                let dateB = dayjs(b.getLabelValue(dateLabel))
                if (dateA.isSame(dateB, "minute")){
                    return earliest == "true" ? a : b
                }
                else if (dateA.isBefore(dateB, "minute")) {
                    return earliest == "true" ? a : b
                } else {
                    return earliest == "true" ? b : a
                }       
            });
        }

        // Send Notification
        if (final) {
            let notification = new window.Notification(
                final.title, 
                {
                    icon: "icon.png", 
                    requireInteraction: true,
                    tag: "trilium-notifications"
                });
            notification.onclick = (event) => {
                event.preventDefault(); // prevent the browser from focusing the Notification's tab
                api.activateNote(final.noteId)
            };
        }
    }    
    
    
    // Reset the Timer
    setTimeout(send_notification, reminderTime * 1000);
}            
            
send_notification()