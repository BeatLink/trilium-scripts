/*
    Instructions: Paste the below into a new JS Backend Script note. 
    Set the note variables to the IDs of the notes you want to use for your categories.
    Remember to set #run=hourly as a label for this note.
    To configure date formats use https://day.js.org/docs/en/display/format
*/

async function run_script() {
    // Imports -----------------------------------------------------------------------------
    const isBetween = (await import('dayjs/plugin/isBetween.js')).default
    api.dayjs.extend(isBetween)

    const advancedFormat = (await import('dayjs/plugin/advancedFormat.js')).default
    api.dayjs.extend(advancedFormat)

    const isSameOrBefore = (await import('dayjs/plugin/isSameOrBefore.js')).default
    api.dayjs.extend(isSameOrBefore)

    // Variables --------------------------------------------------------------------
    let useNumberOfDays = true // intervals are determined based on number of days
    let now = api.dayjs()
    let startOfToday = now.startOf("day")
    let endOfToday = now.endOf("day")
    let endOfThisWeek = useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week")
    let endOfThisMonth = useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month")
    let endOfThisYear = useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year")

    // User Set Variables -----------------------------------------------------------------
    let dueDatetimeLabel = "dueDate"
    let searchCriteria = `# ~template.title="Routine" OR ~template.title="Project"`
    let parentNotes = {
        "now": "zUgTNjqLMROR",
        "upcoming": "SpWaU2490gYz"
    }
    let intervals = {
        'overdue': {
            'criteria': (datetime) => {
                return datetime.isBefore(startOfToday)
            },
            'parent': 'now',
            'formatString': "MMM D, YYYY HH:mm"
        },
        'now': {
            'criteria': (datetime) => {
                return datetime.isBefore(now)
            },
            'parent': 'now',
            'formatString': "HH:mm"
        },
        'restOfDay': {
            'criteria': (datetime) => {
                return datetime.isBetween(now, endOfToday, null, '[)')
            },
            'parent': 'upcoming',
            'formatString': "HH:mm"
        },
        'thisWeek': {
            'criteria': (datetime) => {
                return datetime.isBetween(endOfToday, endOfThisWeek, null, '[)')
            },
            'parent': 'upcoming',
            'formatString': "ddd"
        },
        'thisMonth': {
            'criteria': (datetime) => {
                return datetime.isBetween(endOfThisWeek, endOfThisMonth, null, '[)')
            },
            'parent': 'upcoming',
            'formatString': "Do"
        },
        'thisYear': {
            'criteria': (datetime) => {
                return datetime.isBetween(endOfThisMonth, endOfThisYear, null, '[]')
            },
            'parent': 'upcoming',
            'formatString': "MMMM"
        },
        'future': {
            'criteria':  (datetime) => {
                return datetime.isAfter(endOfThisYear)
            },
            'parent': 'upcoming',
            'formatString': "YYYY"
        }
    }
    // Clear existing note branches
    for (parent in parentNotes){
        var parentNote = parentNotes[parent]
        for (let note of api.getNote(parentNote).getChildNotes()){
            api.toggleNoteInParent(false, note.noteId, parentNote)
        } 
    }
    // Set notes according to criteria
    for (let note of api.searchForNotes(searchCriteria)){
        if (note.getLabelValue(dueDatetimeLabel)){
            let dueDatetime = api.dayjs(note.getLabelValue(dueDatetimeLabel))       
            for (let interval in intervals){
                var criteria = intervals[interval]['criteria']
                var parent = parentNotes[intervals[interval]['parent']]
                var formatString = intervals[interval]['formatString']
                var datetimeFormatted = dueDatetime.format(formatString)
                if (criteria(dueDatetime)){
                    api.toggleNoteInParent(criteria, note.noteId, parent, datetimeFormatted)
                    continue
                }        
            }
        }
    }
}

run_script()