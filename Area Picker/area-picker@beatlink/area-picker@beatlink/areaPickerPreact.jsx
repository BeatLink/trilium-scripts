/*
    This is a custom widget that allows you to set the priority of a note. 
    Add this to a JS Frontend file and set label of #widget. 
    Set a #priorityLabel= label for the label to store the priority of each note
*/

import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact";
import { searchForNotes, getActiveContextNote, currentNote, log } from "trilium:api";

export default defineWidget({
    parent: "right-pane",    
    position: 2,
    render() {
        let defaultDropdownOption = [{noteId: "none", name: "No Area Found"}]
        const [visible, setVisible] = useState(false);        
        const [existingAreas, setExistingAreas] = useState(defaultDropdownOption);
        const [dropdownValue, setDropdownValue] = useState("none");        
        const { note } = useActiveNoteContext();
        const noteId = useNoteProperty(note, "noteId");
        useEffect(() => {
            (async () => { 
                let profileNote = await currentNote.getRelationTarget("profile")
                let profile = JSON.parse(await profileNote.getContent())['values']
                setVisible(
                    (await getActiveContextNote())
                    .getLabelValue("label:area") ? true : false
                )
                setExistingAreas(
                    Object.entries(profile)
                    .map(([key, value]) => ({label: key, title: value.title}))
                )
                setDropdownValue(
                    (await getActiveContextNote())
                    .getLabelValue("area") ?? "none" 
                )
            })()
        }, [noteId]);
        const saveArea = (area) => {
            api.runOnBackend((noteId, area) => {
                let profileNote = api.currentNote.getRelationTarget("profile")
                let profile = JSON.parse(profileNote.getContent())['values']
                if (area != "none") {
                    api.getNote(noteId).setLabel("area", area)
                    api.getNote(noteId).setLabel("color", profile[area]['color'])
                } else {
                    api.getNote(noteId).removeLabel("area")
                    api.getNote(noteId).removeLabel("color")
                }
            }, [note.noteId, area]) 
            setDropdownValue(area)     
        }
        return (
            <>
            {
                visible && 
                <RightPanelWidget id="x-area-picker" title="Area">
                    <div id="x-area-picker-widget">
                        <FormDropdownList
                            class="dropdown-component"
                            values={existingAreas}
                            currentValue={dropdownValue}
                            onChange={value => { saveArea(value)}}
                            keyProperty="label" titleProperty="title"
                            class="form-control"
                        />
                    </div>
                </RightPanelWidget>
            }
            </>
        ) 
    }
})
