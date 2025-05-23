/*
    This is a custom widget that allows you to set the recurrence of a repeating task note. 
    
    Setup Instruction
    1. Add this to a JS Frontend file 
    2. Set label of #widget.
    3. Set a relation ~recurrenceHtml pointing to the html file
    4. Set a relation ~recurrenceCss pointing to the CSS file
 
 */

// Helper Function -------------------------------------------------------------------------
async function getNoteContent(noteId){
    return await api.runOnBackend((noteId) => {
        return api.getNote(noteId).getContent()
    }, [noteId]);
}

// Load Source Code -------------------------------------------------------------------------
const htmlNote = await api.currentNote.getRelationValue("recurrenceHtml")
const cssNote = await api.currentNote.getRelationValue("recurrenceCss")
const recurrenceLabel = await api.currentNote.getLabelValue("recurrenceLabel")
const html = await getNoteContent(htmlNote)
const css = await getNoteContent(cssNote)
$('<style>').text(css).appendTo(document.head)

// Recurrence Widget ------------------------------------------------------------------------
class RecurrenceWidget extends api.NoteContextAwareWidget {

    position = 3;
    
    get parentWidget() { return 'right-pane'; }
    
    isEnabled() {
        return super.isEnabled() && api.getActiveContextNote().hasLabel(`label:${recurrenceLabel}`)
    }
    
    async doRender() {
        this.$widget = $(html);
        this.$widget.addClass("component");        
        this.$recurrenceDataInput = this.$widget.find('#recurrenceDataInput');
        this.$widget.find('#header-div').addClass("card-header");
        var inputs = [
            "enabledInput",
            "intervalNumberInput",
        	"intervalInput",
            "weekInputSU",
            "weekInputMO",
            "weekInputTU",
            "weekInputWE",
            "weekInputTH",
            "weekInputFR",
            "weekInputSA",
            "monthOrdinalInput",
            "monthWeekdayInput",
            "stopTypeInput",
            "stopNumberInput",
            "stopDateInput"
        ]
        for (var element of inputs){
        	this.$widget.find(`#${element}`).on("change", await this.saveData.bind(this));
        }
        return this.$widget;
    }

    async saveData(){
        const recurrenceString = this.$recurrenceDataInput.val()
        const currentNoteID = api.getActiveContextNote().noteId
        api.runOnBackend(
            (note, label, value) => { api.getNote(note).setLabel(label, value) }, 
            [currentNoteID, recurrenceLabel, recurrenceString]
        );
    }

    async refreshWithNote(note) {
        const recurrenceString = await note.getLabelValue(recurrenceLabel)
        this.$recurrenceDataInput.val(recurrenceString)
        loadRecurrenceData()
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new RecurrenceWidget();