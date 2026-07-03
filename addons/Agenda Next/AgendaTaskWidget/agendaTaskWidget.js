let rrulelib = require("rrule.min.js")

const startDatetimeLabel = "startDateTime"
const startDateLabel = "startDate"
const startTimeLabel = "startTime"
const dueDatetimeLabel = "dueDateTime"
const dueDateLabel = "endDate"
const dueTimeLabel = "endTime"
const durationLabel = "duration"
const recurrenceLabel = "recurrence"
const priorityLabel = "priority"
const priorityColors = true


// Helper Functions -------------------------------------------------------------------------
async function getNoteContent(noteId){
    return await api.runOnBackend((noteId) => {
        return api.getNote(noteId).getContent()
    }, [noteId]);
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function durationToObject(input){
    const durationRegex = /^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/
    const duration = input.match(durationRegex)
    if (duration) {
        const properties = duration.slice(2)
        const numberD = properties.map(value => (value != null ? Number(value) : 0));
        let [years, months, weeks, days, hours, minutes, seconds] = numberD
        return {
            second: seconds,
            minute: minutes,
            hour: hours,
            day: days,
            week: weeks,
            month: months,
            year: years
        }
    }
}

// Load Source Code -------------------------------------------------------------------------
const htmlNote = await api.currentNote.getRelationValue("htmlNote")
const cssNote = await api.currentNote.getRelationValue("cssNote")
const html = await getNoteContent(htmlNote)
const css = await getNoteContent(cssNote)
$('<style>').text(css).appendTo(document.head)

// Recurrence Widget ------------------------------------------------------------------------
class agendaTaskWidget extends api.NoteContextAwareWidget {

    position = 2;
    
    get widgetTitle() { return "Task"; }
    
    get parentWidget() { return 'right-pane'; }
        
    async doRenderBody() {
        this.$body.empty()
        this.$body.closest('div.widget').hide();
        if (this.note && this.note.hasLabel("agendaTaskWidget")) {
            this.$body.append($(html));
            this.$body.closest('div.widget').show();
            this.$body.addClass("component");
            this.$startDateInput = this.$body.find('#startDateInput');
            this.$startDateInput.on("change", await this.saveData.bind(this))
            
            this.$dueDateInput = this.$body.find('#dueDateInput');
            this.$dueDateInput.on("change", await this.saveData.bind(this))
            
            this.$durationInput = this.$body.find('#durationInput');
            this.$durationInput.on("change", await this.saveData.bind(this))
    
            this.$recurrenceDataInput = this.$body.find('#recurrenceDataInput');
            this.$recurrenceDataInput.on("change", await this.saveData.bind(this))

            this.$recurrenceDataLoadTrigger = this.$body.find("#recurrenceDataLoadTrigger")

            this.$priorityInput = this.$body.find('#priorityInput');
            this.$priorityInput.on("change", await this.saveData.bind(this))

            this.$markDoneButton = this.$body.find('#markDoneButton');
            this.$markDoneButton.on("click", await this.markDone.bind(this))
            
            this.$rescheduleTodayButton = this.$body.find('#rescheduleTodayButton');
            this.$rescheduleTodayButton.on("click", await this.rescheduleToday.bind(this))
    
            this.$rescheduleTomorrowButton = this.$body.find('#rescheduleTomorrowButton');
            this.$rescheduleTomorrowButton.on("click", await this.rescheduleTomorrow.bind(this))
                        
            await this.loadData()
        }
    }
    
    async refreshWithNote(note) {
        this.doRenderBody()
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }

    async loadData(){
        this.$startDateInput.val(this.note.getLabelValue(startDatetimeLabel))
        this.$dueDateInput.val(this.note.getLabelValue(dueDatetimeLabel))      
        this.$durationInput.val(this.note.getLabelValue(durationLabel))
        this.$recurrenceDataInput.val(this.note.getLabelValue(recurrenceLabel))
        this.$recurrenceDataLoadTrigger.trigger('click');
        this.$priorityInput.val(this.note.getLabelValue(priorityLabel))
        if (this.$startDateInput.val() && this.$durationInput.val()) {
            let startDate = api.dayjs(this.$startDateInput.val())
            let duration = durationToObject(this.$durationInput.val());
            let dueDate = startDate
            for (const [key, value] of Object.entries(duration)){
                dueDate = dueDate.add(value, key)
            }
            this.$dueDateInput.val(dueDate.format("YYYY-MM-DDTHH:mm"))
        }
    }

    async saveData(){
        // Calculate Recurrence String from UI Values
        //setRecurrenceData()

        // Override the Due Date if a start date and duration is present
        if (this.$startDateInput.val() && this.$durationInput.val()) {
            let startDate = api.dayjs(this.$startDateInput.val())
            let duration = durationToObject(this.$durationInput.val());
            let dueDate = startDate
            for (const [key, value] of Object.entries(duration)){
                dueDate = dueDate.add(value, key)
            }
            this.$dueDateInput.val(dueDate.format("YYYY-MM-DDTHH:mm"))
        }

        // Create note data object to pass to backend
        let noteData = {}
        noteData[startDatetimeLabel] = this.$startDateInput.val()
        noteData[startDateLabel] = ""
        noteData[startTimeLabel] = ""
        noteData[dueDatetimeLabel] = this.$dueDateInput.val()
        noteData[dueDateLabel] = ""
        noteData[dueTimeLabel] = ""
        noteData[durationLabel] = this.$durationInput.val()
        noteData[recurrenceLabel] = this.$recurrenceDataInput.val()
        noteData[priorityLabel] = this.$priorityInput.val()
        if (priorityColors){
            let priorityDict = {
                "4-critical": "red",
                "3-high": "gold",
                "2-medium": "lime",
                "1-low": "cyan"
            }
            noteData["color"] = priorityDict[noteData[priorityLabel]]
        }

        // Break start and due dates down into separate date and time attributes. This is to enable proper display in the inbuilt calendar collection
        if (noteData[startDatetimeLabel]) {
            let startDate = api.dayjs(noteData[startDatetimeLabel])
            noteData[startDateLabel] = startDate.format("YYYY-MM-DD")
            noteData[startTimeLabel] = startDate.format("HH:mm")
        }
        if (noteData[dueDatetimeLabel]) {
            let dueDate = api.dayjs(noteData[dueDatetimeLabel])
            noteData[dueDateLabel] = dueDate.format("YYYY-MM-DD")
            noteData[dueTimeLabel] = dueDate.format("HH:mm")
        }

        // Send the task data to the backend for saving
        api.runOnBackend(
            (note, noteData) => {
                for (let [key, value] of Object.entries(noteData)){
                    if (value) {
                        if (key == "duration") {
                            let title = api.getNote(note).title
                            title = `${title.replace(/\s*\([^)]*\)\s*$/, "")} (${value.substring("2").toLowerCase()})`
                            api.getNote(note).title = title
                            api.getNote(note).save()
                        }
                        api.getNote(note).setLabel(key, value)
                    } else {
                        api.getNote(note).removeLabel(key)
                    }                     
                }
            }, 
            [this.noteId, noteData]
        );
        await api.waitUntilSynced()
        await api.reloadNotes([this.noteId])
        api.refreshIncludedNote([this.noteId])
    }
    
    async markDone(){
        await this.saveData()
        if (this.note.hasLabel(startDatetimeLabel) && this.note.hasLabel(recurrenceLabel)) {
            const recurrenceString = this.note.getLabelValue(recurrenceLabel) 
            const start = new Date(this.note.getLabelValue(startDatetimeLabel))
            var options = rrulelib.RRule.parseString(recurrenceString)
    		options.dtstart = start
    		var rrule = new rrulelib.RRule(options)        
    		const nextDate = rrule.after(start, false)
            const nextDateString = formatDate(nextDate)
            await api.runOnBackend((currentNoteID, startDatetimeLabel, newstart) => {
                const currentNote = api.getNote(currentNoteID)
                var content = currentNote.getContent()
                content = content.replaceAll('checked="checked"', "")
                currentNote.setContent(content, {forceSave: true})
                currentNote.setLabel(startDatetimeLabel, newstart)
                currentNote.removeLabel("archived") 
                function unarchiveChildren(childNote){
                    childNote.removeLabel("archived")    
                    var children = childNote.getChildNotes()
                    for (let child of children){
                        unarchiveChildren(child)
                    }
                }
                unarchiveChildren(currentNote)
            }, [this.noteId, startDatetimeLabel, nextDateString]);    
        } else {
            await api.runOnBackend((currentNoteID) => {
                const currentNote = api.getNote(currentNoteID)
            	currentNote.setLabel("archived")    
            }, [this.noteId])
        }
        this.loadData()
    }

    async rescheduleToday() {
        await this.saveData()
        await api.runOnBackend((currentNoteID, startDatetimeLabel) => {
            const currentNote = api.getNote(currentNoteID)
            let startDate = api.dayjs(currentNote.getLabelValue(startDatetimeLabel))
            let newDate = api.dayjs()
            newDate = newDate.hour(startDate.hour())
            newDate = newDate.minute(startDate.minute())
            newDate = newDate.second(0)
            newDate = newDate.millisecond(0)
            let newDateString = newDate.format("YYYY-MM-DDTHH:mm")
            currentNote.setLabel(startDatetimeLabel, newDateString)
        }, [this.noteId, startDatetimeLabel]);
        this.loadData()
    }

    async rescheduleTomorrow() {
        await this.saveData()
        await api.runOnBackend((currentNoteID, startDatetimeLabel) => {
            const currentNote = api.getNote(currentNoteID)
            let startDate = api.dayjs(currentNote.getLabelValue(startDatetimeLabel))
            let newDate = api.dayjs().add(1, 'day')
            newDate = newDate.hour(startDate.hour())
            newDate = newDate.minute(startDate.minute())
            newDate = newDate.second(0)
            newDate = newDate.millisecond(0)
            let newDateString = newDate.format("YYYY-MM-DDTHH:mm")
            currentNote.setLabel(startDatetimeLabel, newDateString)
        }, [this.noteId, startDatetimeLabel]);
        this.loadData() 
    }
}

module.exports = new agendaTaskWidget();