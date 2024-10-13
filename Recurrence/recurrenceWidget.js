/*
    This is a custom widget that allows you to set the recurrence of a repeating task note. 

    Add this to a JS Frontend file 
    Set label of #widget.
    Clone the requirrencelib.js widget to to this script as a subnote
    Create a note relation "~recurrenceTemplate" pointing to the template for recurring tasks
    
*/

let recurrencelib = require("recurrencelib")

// User Variables ----------------------------------------------------------------------------
const recurrenceLabel = "Repeats"
const recurrenceAttachmentTitle = "Recurrence.json"


// Load HTML ------------------------------------------------------------------------------------------------------------------------------
const html = `
    <div style="display: flex; flex-direction: column; padding: 10px; border-top: 1px solid var(--main-border-color); contain: none;">
        <p>Recurrence</p>
        <form name="recurrenceForm">

            <input id="recurrenceDataInput" type="hidden" name="recurrenceData" value="RECURRENCE_DATA">

            <fieldset id="enabledFieldset">
                <legend>Enabled</legend>
                <input id="enabledCheckbox" type="checkbox" value="True">
                <label for="enabledCheckbox">This To-Do Repeats</label>
            </fieldset>

            <fieldset id="intervalFieldset">
                <legend>Interval</legend>
                <input id="intervalNumberSpinbutton" type="number" min="1" max="999" step="1" value="1" class="form-control">
                <select id="intervalDropdown" class="form-control">
                    <option value="minute" selected>Minute</option>
                    <option value="hour">Hour</option>
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="year">Year</option>
                </select>
            </fieldset>

            <fieldset id="weekFieldset">
                <legend>Weekdays</legend>
                <table>
                    <tr>
                        <td><input id="weekSundayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekSundayCheckbox">Sunday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekMondayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekMondayCheckbox">Monday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekTuesdayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekTuesdayCheckbox">Tuesday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekWednesdayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekWednesdayCheckbox">Wednesday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekThursdayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekThursdayCheckbox">Thursday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekFridayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekFridayCheckbox">Friday</label></td>
                    </tr>
                    <tr>
                        <td><input id="weekSaturdayCheckbox" type="checkbox" value="true"></td>
                        <td><label for="weekdaySaturdayCheckbox">Saturday</label></td>
                    </tr>
                </table>	
            </fieldset>

            <fieldset id="monthFieldset">
                <legend>Weekday of Month</legend>
                <select id="monthOrdinalDropdown" class="form-control">
                    <option value="first" selected>First</option>
                    <option value="second">Second</option>
                    <option value="third">Third</option>
                    <option value="fourth">Fourth</option>
                    <option value="last">Last</option>
                </select>
                <select id="monthWeekdayDropdown" class="form-control">
                    <option value="none" selected>None</option>
                    <option value="sunday">Sunday</option>
                    <option value="monday">Monday</option>
                    <option value="tuesday">Tuesday</option>
                    <option value="wednesday">Wednesday</option>
                    <option value="thursday">Thursday</option>
                    <option value="friday">Friday</option>
                    <option value="saturday">Saturday</option>
                </select>
            </fieldset>

            <fieldset id="stopFieldset">
                <legend>Repeating Stops</legend>
                <select id="stopTypeDropdown" class="form-control">
                    <option value="never">Never</option>
                    <option value="number">After # of Repeats</option>
                    <option value="date">After a date</option>
                </select>
                <input id="stopNumberSpinbutton" type="number" min="1" max="999" step="1" value="1" class="form-control">
                <input id="stopDatePicker" type="date" class="form-control">
            </fieldset>

        </form>
    </div>
`
// Load CSS -------------------------------------------------------------------------------------------------------------------------------
const css = `
    #intervalFieldset, #weekFieldset, #monthFieldset, #monthOrdinalDropdown, #stopFieldset, #stopTypeDropdown #stopNumberSpinbutton, #stopDatePciker{
        display: none;
    }

    fieldset {
        margin: 12px 0px;
    }
`
$('<style>').text(css).appendTo(document.head)

// Constants --------------------------------------------------------------------------------
const intervalList = ["minute", "hour", "day", "week", "month", "year"]
const monthOrdinalList = ["first", "second", "third", "fourth", "last"]
const weekdayList = ["none", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const stopTypeList = ["never", "number", "date"]


// Recurrence Widget ------------------------------------------------------------------------
class RecurrenceWidget extends api.NoteContextAwareWidget {
    get position() { return 1; }
    
    get parentWidget() { return 'right-pane'; }
    
    isEnabled() { 
        return super.isEnabled() && 
            this.note.getRelationValue("template") == api.currentNote.getRelationValue("recurrenceTemplate") 
    }
   
    async doRender() {
        this.$widget = $(html);
        this.$enabledCheckbox = this.$widget.find('#enabledCheckbox');
        this.$intervalFieldset = this.$widget.find('#intervalFieldset');
        this.$intervalNumberSpinbutton = this.$widget.find('#intervalNumberSpinbutton');
        this.$intervalDropdown = this.$widget.find('#intervalDropdown');
        this.$weekFieldset = this.$widget.find('#weekFieldset');
        this.$weekSundayCheckbox = this.$widget.find('#weekSundayCheckbox')
        this.$weekMondayCheckbox = this.$widget.find('#weekMondayCheckbox')
        this.$weekTuesdayCheckbox = this.$widget.find('#weekTuesdayCheckbox')
        this.$weekWednesdayCheckbox = this.$widget.find('#weekWednesdayCheckbox')
        this.$weekThursdayCheckbox = this.$widget.find('#weekThursdayCheckbox')
        this.$weekFridayCheckbox = this.$widget.find('#weekFridayCheckbox')
        this.$weekSaturdayCheckbox = this.$widget.find('#weekSaturdayCheckbox')
        this.$stopFieldset = this.$widget.find('#stopFieldset');       
        this.$monthFieldset = this.$widget.find('#monthFieldset');
        this.$monthOrdinalDropdown = this.$widget.find('#monthOrdinalDropdown');
        this.$monthWeekdayDropdown = this.$widget.find('#monthWeekdayDropdown');
        this.$stopTypeDropdown = this.$widget.find('#stopTypeDropdown');
        this.$stopNumberSpinbutton = this.$widget.find('#stopNumberSpinbutton');
        this.$stopDatePicker = this.$widget.find('#stopDatePicker');
        this.$enabledCheckbox.on("change", this.onEnabledChanged.bind(this))
        this.$enabledCheckbox.on("change", this.onIntervalChanged.bind(this));
        this.$enabledCheckbox.on("change", this.onStopTypeChanged.bind(this));
        this.$intervalDropdown.on("change", this.onIntervalChanged.bind(this));
        this.$intervalDropdown.on("change", this.onMonthWeekdayChanged.bind(this));
        this.$intervalNumberSpinbutton.on("change", this.saveData.bind(this));
        this.$weekSundayCheckbox.on("change", this.saveData.bind(this));
        this.$weekMondayCheckbox.on("change", this.saveData.bind(this));
        this.$weekTuesdayCheckbox.on("change", this.saveData.bind(this));
        this.$weekWednesdayCheckbox.on("change", this.saveData.bind(this));
        this.$weekThursdayCheckbox.on("change", this.saveData.bind(this));
        this.$weekFridayCheckbox.on("change", this.saveData.bind(this));
        this.$weekSaturdayCheckbox.on("change", this.saveData.bind(this));
        this.$monthWeekdayDropdown.on('change', this.onMonthWeekdayChanged.bind(this));
        this.$monthOrdinalDropdown.on('change', this.saveData.bind(this))
        this.$stopTypeDropdown.on("change", this.onStopTypeChanged.bind(this));
        this.$stopNumberSpinbutton.on("change", this.saveData.bind(this));
        this.$stopDatePicker.on("change", this.saveData.bind(this));
        return this.$widget;
    }

    async saveData(){
        const currentNoteID = await api.getActiveContextNote().noteId
        const recurrence = new recurrencelib.Recurrence()
        recurrence.enabled = this.$enabledCheckbox.prop('checked')
        recurrence.intervalNumber = this.$intervalNumberSpinbutton.val()
        recurrence.interval = this.$intervalDropdown.val()
        recurrence.weekSunday = this.$weekSundayCheckbox.prop("checked")
        recurrence.weekMonday = this.$weekMondayCheckbox.prop("checked")
        recurrence.weekTuesday = this.$weekTuesdayCheckbox.prop("checked")
        recurrence.weekWednesday = this.$weekWednesdayCheckbox.prop("checked")
        recurrence.weekThursday = this.$weekThursdayCheckbox.prop("checked")
        recurrence.weekFriday = this.$weekFridayCheckbox.prop("checked")
        recurrence.weekSaturday = this.$weekSaturdayCheckbox.prop("checked")
        recurrence.monthOrdinal = this.$monthOrdinalDropdown.val()
        recurrence.monthWeekday = this.$monthWeekdayDropdown.val()
        recurrence.stopType = this.$stopTypeDropdown.val()
        recurrence.stopNumber = this.$stopNumberSpinbutton.val()
        recurrence.stopDate = this.$stopDatePicker.val()
        const recurrenceJSON = recurrencelib.recurrenceToJSON(recurrence) 
        api.runOnBackend((currentNoteID, recurrenceAttachmentTitle, recurrenceJSON) => {
            api.getNote(currentNoteID).saveAttachment({
                role: "recurrenceInfo",
                mime: " application/json",
                title: recurrenceAttachmentTitle,
                content: recurrenceJSON}, "title")           
        }, [currentNoteID, recurrenceAttachmentTitle, recurrenceJSON]);
    }

    async refreshWithNote(note) {
        //Initialize the fields        
        this.$enabledCheckbox.prop('checked', false)
        this.$intervalNumberSpinbutton.val("1")
        this.$intervalDropdown.val("minute")
        this.$weekSundayCheckbox.prop("checked", false)
        this.$weekMondayCheckbox.prop("checked", false)
        this.$weekTuesdayCheckbox.prop("checked", false)
        this.$weekWednesdayCheckbox.prop("checked", false)
        this.$weekThursdayCheckbox.prop("checked", false)
        this.$weekFridayCheckbox.prop("checked", false)
        this.$weekSaturdayCheckbox.prop("checked", false)   
        this.$monthOrdinalDropdown.val("first")
        this.$monthWeekdayDropdown.val("none")
        this.$stopTypeDropdown.val("never")
        this.$stopNumberSpinbutton.val("1")
        this.$stopDatePicker.val("")
        
        // Load recurrence data from attachment
        const recurrenceJSON = await api.runOnBackend(
            (currentNoteID, recurrenceAttachmentTitle) => {
                const note = api.getNote(currentNoteID)
                const attachment = note.getAttachmentByTitle(recurrenceAttachmentTitle)
                return attachment ? attachment.getContent().toString() : ""
                
        }, [note.noteId, recurrenceAttachmentTitle])
        console.log(recurrenceJSON)        
        if (recurrenceJSON){
            var recurrence = recurrencelib.recurrenceFromJSON(recurrenceJSON)
            this.$enabledCheckbox.prop('checked', recurrence.enabled)
            this.$intervalNumberSpinbutton.val(recurrence.intervalNumber)
            this.$intervalDropdown.val(recurrence.interval)
            this.$weekSundayCheckbox.prop("checked", recurrence.weekSunday)
            this.$weekMondayCheckbox.prop("checked", recurrence.weekMonday)
            this.$weekTuesdayCheckbox.prop("checked", recurrence.weekTuesday)
            this.$weekWednesdayCheckbox.prop("checked", recurrence.weekWednesday)
            this.$weekThursdayCheckbox.prop("checked", recurrence.weekThursday)
            this.$weekFridayCheckbox.prop("checked", recurrence.weekFriday)
            this.$weekSaturdayCheckbox.prop("checked", recurrence.weekSaturday)
            this.$monthOrdinalDropdown.val(recurrence.monthOrdinal)
            this.$monthWeekdayDropdown.val(recurrence.monthWeekday)
            this.$stopTypeDropdown.val(recurrence.stopType)
            this.$stopNumberSpinbutton.val(recurrence.stopNumber)
            this.$stopDatePicker.val(recurrence.stopDate)
        }
        await this.onEnabledChanged()
        await this.onIntervalChanged()
        await this.onMonthWeekdayChanged()
        await this.onStopTypeChanged()
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
    
    // Functions ------------------------------------------------------------------------
    async onEnabledChanged(){
        if (this.$enabledCheckbox.prop('checked')) {
            this.$intervalFieldset.css("display",'block');
            this.$stopFieldset.css("display",'block');
        } else {
            this.$intervalFieldset.css("display",'none');
            this.$stopFieldset.css("display",'none');
        }
        await this.saveData()
    }

    async onIntervalChanged(){
        if (this.$enabledCheckbox.prop('checked') && this.$intervalDropdown.val() == "week") {
            this.$weekFieldset.css("display",'block');
        } else {
            this.$weekFieldset.css("display",'none');
        }
        if (this.$enabledCheckbox.prop('checked') && this.$intervalDropdown.val() == "month") {
            this.$monthFieldset.css("display",'block');
        } else {
             this.$monthFieldset.css("display",'none');
        }
        await this.saveData()
    }
    
    async onMonthWeekdayChanged(){
        if (this.$monthWeekdayDropdown.val() != 'none') {
            this.$monthOrdinalDropdown.css("display",'inline');
        } else {
            this.$monthOrdinalDropdown.css("display",'none');
        }
        await this.saveData()
    }
    
    async onStopTypeChanged(){
        if (this.$enabledCheckbox.prop('checked') && this.$stopTypeDropdown.val() == 'date') {
            this.$stopDatePicker.css("display", 'block');
        } else {
            this.$stopDatePicker.css("display", 'none');
        }
        if (this.$enabledCheckbox.prop('checked') && this.$stopTypeDropdown.val() ==  'number') {
            this.$stopNumberSpinbutton.css("display",'block');
        } else {
            this.$stopNumberSpinbutton.css("display",'none');
        }
        await this.saveData()
    }

}

module.exports = new RecurrenceWidget();