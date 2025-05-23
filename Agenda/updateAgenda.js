/*
    Instructions: Paste the below into a new JS Backend Script note. 
    Set ~agendaProfile relationships pointing to the JSON files of the profiles you wish to load.
    Remember to set #run=hourly as a label for this note.
*/

async function run_script() {
    
    // Imports
    const isBetween = (await import("dayjs/plugin/isBetween.js")).default
    api.dayjs.extend(isBetween)

    const advancedFormat = (await import("dayjs/plugin/advancedFormat.js")).default
    api.dayjs.extend(advancedFormat)

    const isSameOrBefore = (await import("dayjs/plugin/isSameOrBefore.js")).default
    api.dayjs.extend(isSameOrBefore)

    // Load Profiles
	let allProfiles = {}
    let profileRelations = api.currentNote.getRelations("agendaProfile")
    for (let relation of profileRelations) {
        let profileNote = api.getNote(relation.value)
    	var profiles = JSON.parse(profileNote.getContent())
        allProfiles = {...allProfiles, ...profiles}
    }

    // Get Parent Notes
    let parentNoteIDs = new Set()
    for (const [name, profile] of Object.entries(allProfiles)) {
        parentNoteIDs.add(profile["parentNoteID"])
    }

    //Delete Notes Under Parents
    for (let parentNoteID of parentNoteIDs){
        let parentNote = api.getNote(parentNoteID)
        for (let note of await parentNote.getChildNotes()){
            api.toggleNoteInParent(false, note.noteId, parentNoteID)
        }
    }

    // Organize Notes According to Critera
    let now = api.dayjs()
    let startOfToday = now.startOf("day")
    for (const [name, profile] of Object.entries(allProfiles)) {
        let parentNote = api.getNote(profile["parentNoteID"])
    	let allNotes = api.searchForNotes(profile["searchCriteria"])    
        if (profile["type"] == "date") {
            let dateLabel = profile["dateLabel"]
            let useNumberOfDays = profile["useNumberOfDays"]
            let dateVars = {
                "now": now,
                "startOfToday": startOfToday,
                "endOfToday": now.endOf("day"),
                "endOfTomorrow": now.endOf("day").add(1, "day"),
                "endOfThisWeek": useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week"),
                "endOfThisMonth": useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month"),
                "endOfThisYear": useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year"),
            }
            for (const [name, interval] of Object.entries(profile['intervals'])) {
                // Skip this interval if hide criteria is met
                if ("hideCriteria" in interval) {
                    let hideLabel = interval["hideCriteria"][0]
                    let hideValue = interval["hideCriteria"][1]
                    if (parentNote.getLabelValue(hideLabel) == hideValue) {
                        continue
                    }
                }
                // Get the datetime function 
                let dateFunc = interval["dateCriteria"].splice(0, 1)[0]

                // Replace all variables in the function args
                let args = interval["dateCriteria"]
                for (let index in args){
                    if (args[index] in dateVars) {
                        args[index] = dateVars[args[index]]
                    }
                }
                // Process the found notes
                for (let note of allNotes){
                    let noteDate = note.getLabelValue(dateLabel)
                    if (noteDate){
                        let date = api.dayjs(noteDate)                   
                        if (date[dateFunc](...args)) {
                            let prefix = date.format(interval["formatString"])
                            api.toggleNoteInParent(true, note.noteId, parentNote.noteId, prefix) 
                        }
                    } else {
                        // Add note to parent with "No Due Date" if enableNoDueDate
                        if (profile["enableNoDueDate"]){
                           api.toggleNoteInParent(true, note.noteId, parentNote.noteId, "No Due Date") 
                        }
                    }
                }
        	}
    	} else if (profile["type"] == "number") {
            let numberLabel = profile["numberLabel"]
            for (let note of allNotes){
                let noteNumber = note.getLabelValue(numberLabel)
                if (noteNumber){
                    api.toggleNoteInParent(true, note.noteId, parentNote.noteId, String(noteNumber)) 
                } else if (profile["enableNoNumber"]){
                    api.toggleNoteInParent(true, note.noteId, parentNote.noteId, "") 
                }
            }
        } else if (profile["type"] == "text") {
            let textLabel = profile["textLabel"]
            for (let note of allNotes){
                let noteText = note.getLabelValue(textLabel)
                if (noteText){
                    if (profile["prefixMap"]){
                        api.toggleNoteInParent(true, note.noteId, parentNote.noteId, String(profile["prefixMap"][noteText])) 
                    } else {
                        api.toggleNoteInParent(true, note.noteId, parentNote.noteId, String(noteText)) 

                    }
                } else if (profile["enableNoValue"]){
                    api.toggleNoteInParent(true, note.noteId, parentNote.noteId, "") 
                }
            }
        }
    }
}

run_script()