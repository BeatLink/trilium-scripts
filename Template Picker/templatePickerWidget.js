/*
This is a custom widget that allows you to easily change the template of the current note via dropdown. Add this to a JS Frontend file and set a label of #widget
*/

const html = `
    <div class="template-picker">
        <div class="card-header">
        	<header for="template-dropdown">Template</header>
        </div>
        <select id="template-dropdown" "class="dropdown"></select>
    </div>
`;

const css = `
    .template-picker {
        display: flex;
        flex-direction: column;
        padding: 10px;
        contain: none;"
    };
`;


class TemplatePickerWidget extends api.NoteContextAwareWidget {
    
    position = 1;
    
    get parentWidget() { return 'right-pane'; }

    isEnabled() { return super.isEnabled() }

    async doRender() {
        this.$widget = $(html);
        this.cssBlock(css);
        this.$dropdown = this.$widget.find('#template-dropdown');
        this.$dropdown.on('change', await this.saveNoteTemplate.bind(this))
        return this.$widget;
    }

    async refreshWithNote(note) {
        await this.loadTemplateList()
        await this.loadTemplateValue()
    }
    
    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
    
    // Main Functions -----------------------------------------------------------------
    async loadTemplateList() {
        var templates = await api.searchForNotes("#template")
        var options = "<option value=''>None</option>"
        for (var template of templates) {
            options += `<option value="${template.noteId}">${template.title}</option>`
        }        
        this.$dropdown.html(options);
    }
    
    async loadTemplateValue() {
        var currentTemplate = await this.note.getRelationTarget("template")
        this.$dropdown.val(currentTemplate ? currentTemplate.noteId : "")
    }
    
    async saveNoteTemplate(){
        await api.runOnBackend((noteID, templateID) => {
            if (templateID) {
                api.getNote(noteID).setRelation("template", templateID)                
            } else {
                api.getNote(noteID).removeRelation("template")
            }                
        }, [this.noteId, this.$dropdown.val()]);
    }
}

module.exports = new TemplatePickerWidget();