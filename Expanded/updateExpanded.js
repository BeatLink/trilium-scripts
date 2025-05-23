/*
    Place the following code in a JS Backend Note. Create a inheritable relation "~runOnBranchChange" on the root node pointing to this script 
*/


async function expand(){
    var notes = await api.searchForNotes('#alwaysExpanded');
    for (var note of notes) {
        for (var branch of await note.getParentBranches()) {
            if (!branch.isExpanded){
                branch.isExpanded = true;
                branch.save();
            }
        }
    }
}

expand()
