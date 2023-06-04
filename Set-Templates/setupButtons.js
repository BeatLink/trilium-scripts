async function setupButtons() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "set_template1_button",
            title: "Set Template 1",
            icon: "bx-refresh",
            type: "script",
            scriptNoteId: "<set-template1-script>",
            isVisible: true
        });
    });
}