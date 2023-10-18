/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Set the scriptNoteIds to the scripts indicated
*/

async function setupButton() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "toggleMobileViewButton",
            title: "Toggle Mobile View",
            icon: " bx-mobile-alt",
            type: "script",
            scriptNoteId: "<path-to-ToggleMobileView.js>",
            isVisible: true
        });
        api.createOrUpdateLauncher({
            id: "setSidebarViewButton",
            title: "Set Sidebar View",
            icon: " bx-chevron-left",
            type: "script",
            scriptNoteId: "<path-to-SetSidebarView.js>",
            isVisible: true
        });
        api.createOrUpdateLauncher({
            id: "setNoteViewButton",
            title: "Set Note View",
            icon: " bx-radio-circle",
            type: "script",
            scriptNoteId: "<path-to-SetNoteView.js>",
            isVisible: true
        });
        api.createOrUpdateLauncher({
            id: "setRightPaneViewButton",
            title: "Set Right Pane View",
            icon: " bx-chevron-right",
            type: "script",
            scriptNoteId: "<path-to-SetRightPanelView.js>",
            isVisible: true
        });
    })
}
setupButton()
