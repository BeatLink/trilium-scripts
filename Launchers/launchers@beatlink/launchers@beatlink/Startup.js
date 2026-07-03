const widgetNoteId = api.currentNote.getRelationValue("launcherLaunchbarNote")

api.createOrUpdateLauncher({
    id: "lnch-launchbar-widget",
    type: "customWidget",
    isVisible: true,
    widgetNoteId: widgetNoteId
})
