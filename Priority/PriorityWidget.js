/*
    This is a custom widget that allows you to set the priority of a note. 
    Add this to a JS Frontend file and set label of #widget. 
    Set a #priorityLabel= label for the label to store the priority of each note
*/

const html = `
<div style="display: flex; flex-direction: column; padding: 10px; border-top: 1px solid var(--main-border-color); contain: none;">
    <label for="priority-dropdown">Priority</label>
    <select name="priority" id="priority-dropdown">
        <option value="3-high">High</option>
        <option value="2-medium">Medium</option>
        <option value="1-low">Low</option>
        <option value="0-none" selected>None</option>
    </select> 
</div>`;

var priorityColors = {
    "3-high": "red",
    "2-medium": "yellow",
    "1-low": "blue",
    "0-none": "#D3D3D3"
}

class PriorityWidget extends api.NoteContextAwareWidget {
    
    get position() { return 1; } // higher value means position towards the bottom/right

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
            api.getNote(currentNoteID).setLabel("priority", priority)      
            api.getNote(currentNoteID).setLabel("color", color)     
        }, [currentNoteID, priorityValue, color]);
    }

    async refreshWithNote(note) {
        var currentPriority = note.getLabelValue("priority")
        $('#priority-dropdown').val(currentPriority ? currentPriority : "0-none")
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new PriorityWidget();