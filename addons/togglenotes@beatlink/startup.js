async function setupButton() {
    let widgetNote = await api.currentNote.getRelationValue("launcherLaunchbarNote")
    await api.runOnBackend((widgetNote) => {
        api.createOrUpdateLauncher({
            id: "toggleNoteLauncher",
            title: "ToggleNote",
            type: "customWidget",
            isVisible: true,
            widgetNoteId: widgetNote,
        });
    }, 
    [widgetNote])
}

setupButton()
