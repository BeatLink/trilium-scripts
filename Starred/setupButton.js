/*
    Instructions: 
    Paste the below into a new JS Frontend Script note. 
    Create a relation for ~toggleStarredScript pointing to the toggleStarred.js
    Add the following label: #run=frontendStartup
*/

async function setupButton() {
    let toggleStarredNote = await api.currentNote.getRelationValue("toggleStarredScript")
    await api.runOnBackend(
        (toggleStarredNote) => {
            api.createOrUpdateLauncher({
                id: "toggleStarredButton",
                title: "Toggle Starred",
                icon: "bx bxs-star-half",
                type: "script",
                isVisible: true,
                scriptNoteId: toggleStarredNote
            });
        }, 
        [toggleStarredNote]);
}

setupButton()
