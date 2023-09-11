/*
    Instructions: Paste the below into a new JS Backend Script note. Set the note variables to the IDs of the notes you want to use for your categories.
    Remember to set #run=hourly as a label for this note.
    To configure date formats use https://day.js.org/docs/en/display/format
*/

// Imports -----------------------------------------------------------------------------
var isBetween = require('dayjs/plugin/isBetween')
api.dayjs.extend(isBetween)

var advancedFormat = require('dayjs/plugin/advancedFormat')
api.dayjs.extend(advancedFormat)

var isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
api.dayjs.extend(isSameOrBefore)


// Criteria Variables --------------------------------------------------------------------
let useNumberOfDays = true // intervals are determined based on number of days
let now = api.dayjs()
let startOfToday = now.startOf("day")
let endOfToday = now.endOf("day")
let endOfThisWeek = useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week")
let endOfThisMonth = useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month")
let endOfThisYear = useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year")

// User Set Variables -----------------------------------------------------------------
let dueDatetimeLabel = "due"
let templateId = "Yps2a0UwNkHK"
let parentNotes = {
    "now": "QpWUSNl5ompI",
    "upcoming": "Qcf6WxdKgvv8"
}
let intervals = {
    'now': {
        'criteria': (datetime) => {return datetime.isBefore(now)},
        'parent': 'now',
        'formatString': "HH:mm"
    },
    'restOfDay': {
        'criteria': (datetime) => {return datetime.isBetween(now, endOfToday, null, '[)')},
        'parent': 'upcoming',
        'formatString': "HH:mm"
    },
    'thisWeek': {
        'criteria': (datetime) => {return datetime.isBetween(endOfToday, endOfThisWeek, null, '[)')},
        'parent': 'upcoming',
        'formatString': "ddd"
    },
    'thisMonth': {
        'criteria': (datetime) => {return datetime.isBetween(endOfThisWeek, endOfThisMonth, null, '[)')},
        'parent': 'upcoming',
        'formatString': "Do"
    },
    'thisYear': {
        'criteria': (datetime) => {return datetime.isBetween(endOfThisMonth, endOfThisYear, null, '[]')},
        'parent': 'upcoming',
        'formatString': "MMMM"
    },
    'future': {
        'criteria':  (datetime) => {return datetime.isAfter(endOfThisYear)},
        'parent': 'upcoming',
        'formatString': "YYYY"
    }
} 

function run_script() {
    // Clear existing note branches
    for (parent in parentNotes){
        var parentNote = parentNotes[parent]
        for (let note of api.searchForNotes(`note.parents.noteId=${parentNote}`)){
            api.toggleNoteInParent(false, note.noteId, parentNote)
        }    
    }
    
    // Set notes according to criteria
    for (let note of api.searchForNotes(`# ~template.noteId=${templateId} AND not(note.parents.relations.template.noteId=${templateId})`)){ 
        if (note.getLabelValue(dueDatetimeLabel)){
            let dueDatetime = api.dayjs(note.getLabelValue(dueDatetimeLabel))       
            for (let interval in intervals){
                var criteria = intervals[interval]['criteria']
                var parent = intervals[interval]['parentNote']
                var formatString = intervals[interval]['formatString']
                var datetimeFormatted = dueDatetime.format(formatString)
                if (criteria(dueDatetime)){
                    api.toggleNoteInParent(criteria, note.noteId, parentNotes[parent], datetimeFormatted)
                    continue
                }        
            }
        }
    }
}

run_script()
