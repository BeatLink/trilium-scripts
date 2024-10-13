/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Create a relation "~nowNextLaterScript" pointing to the ToggleNowNextLater.js note
*/

async function setupButton() {
    let nowNextLaterScript = await api.currentNote.getRelationValue("nowNextLaterScript")
    await api.runOnBackend((nowNextLaterScript) => {
        api.createOrUpdateLauncher({
            id: "ToggleNowNextLaterButton",
            title: "Toggle Now/Next/Later",
            icon: "bxs-star",
            type: "script",
            isVisible: true,
            scriptNoteId: nowNextLaterScript
        });
    }, [nowNextLaterScript])
}

setupButton()