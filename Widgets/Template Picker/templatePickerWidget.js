/*
This is a custom widget that allows you to easily change the template of the current note via dropdown. Add this to a JS Frontend file and set a label of #widget
*/

const html = `
<div style="display: flex; flex-direction: column; padding: 10px; border-top: 1px solid var(--main-border-color); contain: none;">
    <label for="template-dropdown">Template</label>
    <select id="template-dropdown" "class="dropdown"></select>
</div>`;

class TemplatePickerWidget extends api.NoteContextAwareWidget {
    
    get position() { return 100; } // higher value means position towards the bottom/right

    get parentWidget() { return 'right-pane'; }

    isEnabled() {
        return super.isEnabled()
    }

    async doRender() {
        this.$widget = $(html);
        this.$dropdown = this.$widget.find('#template-dropdown');
        this.$dropdown.on('change', async function (e) {
            const currentNoteID = await api.getActiveContextNote().noteId
            const templateNoteID = $(this).val()
            api.runOnBackend((currentNoteID, templateID) => {
                if (templateID == "none") {
                    api.getNote(currentNoteID).removeRelation("template")
                } else {
                    api.getNote(currentNoteID).setRelation("template", templateID)                
                }                
            }, [currentNoteID, templateNoteID]);
        })
        return this.$widget;
    }

    async refreshWithNote(note) {
        var options = "<option value='none'>None</option>"
        var notes = await api.searchForNotes("#template")
        for (var note of notes) {
            options += `<option value="${note.noteId}">${note.title}</option>`
        }        
        this.$dropdown.html(options);        
        var currentTemplate = await api.getActiveContextNote().getRelationTarget("template")
        this.$dropdown.val(currentTemplate ? currentTemplate.noteId : "none")
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new TemplatePickerWidget();