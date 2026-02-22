/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Create a relationship "~MobileViewWidget" pointing to the Mobile View.js file
*/

async function setupButton() {
    let widgetNote = await api.currentNote.getRelationValue("MobileViewWidget")
    await api.runOnBackend((widgetNote) => {
        api.createOrUpdateLauncher({
            id: "mobileViewWidget",
            title: "Mobile View",
            type: "customWidget",
            isVisible: true,
            widgetNoteId: widgetNote,
        });
    }, 
    [widgetNote])
}

setupButton()
