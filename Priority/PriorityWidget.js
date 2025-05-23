/*
    This is a custom widget that allows you to set the priority of a note. 
    Add this to a JS Frontend file and set label of #widget. 
    Set a #priorityLabel= label for the label to store the priority of each note
*/

const html = `
<div style="display: flex; flex-direction: column; padding: 10px; contain: none;">
    <label for="priority-dropdown"><div class="card-header">Priority</div></label>
    <select name="priority" id="priority-dropdown">
    	<option value="3-high">High</option>
        <option value="2-medium">Medium</option>
        <option value="1-low">Low</option>
        <option value="" selected>None</option>
    </select>
</div>`;

var priorityColors = {
    "3-high": "red",
    "2-medium": "gold",
    "1-low": "blue",
}

class PriorityWidget extends api.NoteContextAwareWidget {
    
    position = 2; // higher value means position towards the bottom/right

    get parentWidget() { return 'right-pane'; }

    isEnabled() {
        return super.isEnabled() && this.note.hasLabel(`label:${api.currentNote.getLabelValue("priorityLabel")}`)
    }

    async doRender() {
        this.$widget = $(html);
        this.$priorityDropdown = this.$widget.find('#priority-dropdown');
        this.$priorityDropdown.on('change', this.savePriorityToNote)
        return this.$widget;
    }

    async savePriorityToNote(e){
        const currentNoteID = await api.getActiveContextNote().noteId
        var priorityValue = $('#priority-dropdown').val()
        let color = priorityColors[priorityValue]
        api.runOnBackend((currentNoteID, priority, color) => {
            if (priority)  {
 	           api.getNote(currentNoteID).setLabel("priority", priority)   
	            api.getNote(currentNoteID).setLabel("color", color)     
            } else {
 	           api.getNote(currentNoteID).removeLabel("priority")   
 	           api.getNote(currentNoteID).removeLabel("color")   
            }
            
        }, [currentNoteID, priorityValue, color]);
    }

    async refreshWithNote(note) {
        var currentPriority = note.getLabelValue("priority")
        $('#priority-dropdown').val(currentPriority ? currentPriority : "")
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new PriorityWidget();