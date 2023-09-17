/*
    Instructions: Paste the below into a new JS Backend Script note. 
    Remember to set #run=hourly as a label for this note.
*/


// User Set Variables -----------------------------------------------------------------
let searchCriteria = `# #priority`
var priorityColors = {
    "3-high": "red",
    "2-medium": "yellow",
    "1-low": "blue",
    "0-none": "#D3D3D3"
}

function run_script() {  
    for (let note of api.searchForNotes(searchCriteria)){
        api.log(note.title)
        var priority = note.getLabelValue("priority")
        api.log(priority)
        var color = priorityColors[priority]
        api.log(color)
        note.setLabel("color", priorityColors[priority])
    }
}

run_script()
