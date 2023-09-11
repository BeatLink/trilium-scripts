/*
This is a custom widget that allows you to set a specified label to a combined datetime value. Add this to a JS Frontend file and set labels of #widget and #enabled=true. 
*/

const label = "due";  //The trillium label the datetime value is stored to
const title = "Due";  //The text displayed as the widget's title

const html = `
<div style="display: flex; flex-direction: column; padding: 10px; border-top: 1px solid var(--main-border-color); contain: none;">
    <label for="datetime-input">${title} Date and Time</label>
    <input type="datetime-local" id="datetime-input" name="datetime" value=""/>
</div>`;

class TemplatePickerWidget extends api.NoteContextAwareWidget {
    
    get position() { return 1; } // higher value means position towards the bottom/right

    get parentWidget() { return 'right-pane'; }

    isEnabled() {
        return (super.isEnabled())
    }

    async doRender() {
        this.$widget = $(html);
        this.$datetimeInput = this.$widget.find('#datetime-input');
        this.$datetimeInput.on('change', this.saveDatetimeToNote)
        return this.$widget;
    }

    async saveDatetimeToNote(e){
        const currentNoteID = await api.getActiveContextNote().noteId
        var datetimeValue = $('#datetime-input').val()
        var datetime = datetimeValue ? api.dayjs(datetimeValue).format("YYYY-MM-DD HH:mm") : ""     
        api.runOnBackend((currentNoteID, datetime, label) => {
            var note = api.getNote(currentNoteID)
            datetime ? note.setLabel(label, datetime) : note.removeLabel(label)            
        }, [currentNoteID, datetime, label]);
    }

    async refreshWithNote(note) {
        var currentNote = await api.getActiveContextNote()
        var currentDatetimeString = currentNote.getLabelValue(label)
        if (currentDatetimeString){
            var currentDatetime =  api.dayjs(currentDatetimeString)
            $('#datetime-input').val(currentDatetime.format("YYYY-MM-DDTHH:mm"))       
        } else {
            $('#datetime-input').val("")
        }
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new TemplatePickerWidget();