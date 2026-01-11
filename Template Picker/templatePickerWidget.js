const html = `
    <div class="main-div">
        <select id="template-select" class="form-control">
        </select>
    </div>
`

const css = `
<style>
    .main-div {
        margin: 0 0.25rem 1rem;
        display: flex;
        flex-wrap: wrap;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        width: 100%;
        background-color: rgba(0, 0, 0, 0.05);
        border-radius: 8px;
        padding: 0.5rem;        
    }

    .mainDiv > * {
        width: 100%
    }
</style>
`

class TemplatePickerWidget extends api.RightPanelWidget {

    // Core Widget functions -----------------------------------------------------------------------
    
    position = 1; // higher value means position towards the bottom/right

    get parentWidget() { return 'right-pane'; }

    get widgetTitle() { return "Template"; }

    async doRenderBody() {
        // Create Widget
        this.$body.empty()

        if (this.note){
            this.$body.append($(html)).append($(css))
    
            // Get Template Select and Setup Event Handler
            this.$templateSelect = this.$body.find(`#template-select`)
            this.$templateSelect.on("change", this.saveTemplate.bind(this))
    
            //Load Templates
            let options = "<option value=''>None</option>"
            for (let note of await api.searchForNotes("#template orderBy note.title")) {
                options += `<option value="${note.noteId}">${note.title}</option>`
            }
            this.$templateSelect.empty().append(options)
    
            // Load Current Template       
            let template = this.note.getRelationValue("template")
            this.$templateSelect.val(template ? template : "")               
        }
    }

    async refreshWithNote(note) {
        await this.doRenderBody()
    }

    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }

    async saveTemplate(e){
        let template = this.$templateSelect.val()                
        api.runOnBackend((noteId, template) => {
            let note = api.getNote(noteId)
            template ? note.setRelation("template", template) : note.removeRelation("template")            
        }, [this.noteId, template]);        
    }
}

module.exports = new TemplatePickerWidget();