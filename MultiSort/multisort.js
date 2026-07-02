/* Multisorted

This script allows notes to be sorted by multiple attributes.

Attributes are separated by semicolons (;)
The following built in attributes are sourced from the note itself and is considered a separate attribute: 
    - noteId
    - title
    - dateCreated
    - dateModified
    
Criteria for each attribute are separated by colons (:)
Current Criteria include: 
    - "desc" for sorting that attribute by descending order 
    - "caseInsensitive" to ignore case for that attribute

To use:
    - Add this script as a JS backend note. 
    - Set up mechanisms to run the script as needed (launcher button, runOnAttributeChanged, etc
    - go to the parent note whose children you want sorted
    - Set #multiSorted="<sortCriteriaHere>"

Example: 
    #multiSorted="priority:desc;area;startDateTime;title:caseInsensitive"

    In the example above, the script will sort children first by priority in descending order, then by area, then by startDateTime then by title ignoring the case

How It works:
    - First the script gets the sort criteria attribute from the parent note and breaks it up according to the delimiters
    - Next, the script parses the data into a sort criteria object to be consumed by the sort function
    - Then for each parent note, the script gets all of its children and creates a separate dictionary array containing all of the relevant attributes to be used in the sorting
    - Next the children dict array and the sort criteria object are passed into the sort function which is based on the code from this article https://vinialbano.com/javascript-multilevel-array-sorting/
    - Once the children are sorted accordingly, they are assigned the numeric index from their array. This value is saved to a dedicated attribute on each child.
    - Lastly, the #sorted attribute of the parent is pointed to this new dedicated attribute. 

*/



// For each child in the sorted dict array, save its array index as an attribute
async function saveChildrenSortOrder(note, sortedChildNotes){
    sortedChildNotes.forEach(
        async (childNote, index, array) => {
            await api.runOnBackend((childNoteId, parentNoteId, index) => {
                let childNote = api.getNote(childNoteId)
                childNote.removeLabel(`multiSortedValue_${parentNoteId}`)
                childNote.setLabel(`multiSortedValue_${parentNoteId}`, `${index.toString().padStart(4, "0")}`)
            }, [childNote.noteId, note.noteId, index])
        }
    )
}

// Set the parent note to used the saved sorting attribute
async function setParentSorting(note){
    await api.runOnBackend((noteId) => {
        api.getNote(noteId).setLabel("sorted", `multiSortedValue_${noteId}`)
    }, [note.noteId])
}

// Main Function
async function multiSort(){
    
    // Check for notes with #multiSorted
    let notesToSort = await api.searchForNotes("#multiSorted")

    for (let note of notesToSort){
        let sortString = await note.getLabelValue("multiSorted")
        let childNotes = await note.getChildNotes()
        let sortedChildNotes = await libMultisort.sortChildNotes(sortString, childNotes)
        await saveChildrenSortOrder(note, sortedChildNotes)
        await setParentSorting(note)
        
        // Todo implement top and bottom
        // Todo implement default sorting
       
    }
}

multiSort()
