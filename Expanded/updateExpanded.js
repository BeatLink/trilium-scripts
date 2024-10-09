/*
    Place the following code in a JS Backend Note. Create a relation "~runOnBranchChange" on the root node pointing to this script 
    For notes that you want to keep expanded, add #alwaysExpanded=true to their parents
*/
async function expand(){
    var notes = await api.searchForNotes('#alwaysExpanded=true');
    for (var note of notes) {
        for (var branch of await note.getChildBranches()) {
            if (!branch.isExpanded){
                branch.isExpanded = true;
                branch.save();
            }
        }
    }
}
expand()
