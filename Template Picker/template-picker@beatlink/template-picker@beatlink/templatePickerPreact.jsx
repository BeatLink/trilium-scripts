import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact";
import { searchForNotes, getActiveContextNote } from "trilium:api";

export default defineWidget({
    parent: "right-pane",    
    position: 1,
    render() {
        let defaultDropdownOption = [{noteId: "none", name: "No Templates Found"}]
        const [existingTemplates, setExistingTemplates] = useState(defaultDropdownOption);
        const [dropdownValue, setDropdownValue] = useState("none");        
        const { note } = useActiveNoteContext();
        const noteId = useNoteProperty(note, "noteId");
        useEffect(() => {
            (async () => { 
                setExistingTemplates(
                    (await searchForNotes("#template #!noTemplatePicker orderBy note.title"))
                    .map(note => ({noteId: note.noteId, title: note.title}))
                    .concat({noteId: "none", title: "None"})
                )
                setDropdownValue(
                    (await getActiveContextNote())
                    .getRelationValue("template") ?? "none" 
                )
            })()
        }, [noteId]);
        const saveTemplate = (template) => {
            api.runOnBackend((noteId, template) => {
                if (template != "none") {
                    api.getNote(noteId).setRelation("template", template)
                } else {
                    api.getNote(noteId).removeRelation("template")
                }
            }, [note.noteId, template]) 
            setDropdownValue(template)     
        }
        return (
            <RightPanelWidget id="x-template-picker" title="Template">
                <div id="x-template-picker-widget">
                        <FormDropdownList
                            class="dropdown-component"
                            values={existingTemplates}
                            currentValue={dropdownValue}
                            onChange={value => { saveTemplate(value)}}
                            keyProperty="noteId" titleProperty="title"
                            class="form-control"
                        />
                </div>
            </RightPanelWidget>
        )        
    }
})
