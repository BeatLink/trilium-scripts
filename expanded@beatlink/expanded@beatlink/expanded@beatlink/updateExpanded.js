function expand(){
    var notes = api.searchForNotes('#alwaysExpanded');
    for (var note of notes) {
        for (var branch of note.getParentBranches()) {
            if (!branch.isExpanded){
                branch.isExpanded = true;
                branch.save();
            }
        }
    }
}
expand()