import { useState, useEffect, FormTextBox, NoteAutocomplete, Button } from "trilium:preact"
import { startNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SearchGroupsEditor } from "profileEditorSearchGroups.jsx"
import { FilterGroupsEditor } from "profileEditorFilterGroups.jsx"
import { SortsEditor } from "profileEditorSorts.jsx"
import { PrefixesEditor } from "profileEditorPrefixes.jsx"
import { ColorsEditor } from "profileEditorColors.jsx"

const { saveProfile, updateTaskLists } = require("libAgendaOverview.js")

export default function ProfileEditor() {
    const [ids, setIds] = useState(null)
    const [profile, setProfile] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const { constants, profileNoteIds } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            const profileNoteId = profileNoteIds[0]
            const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [profileNoteId])
            setIds({ constants, profileNoteIds, profileNoteId, icalNoteId })
            setProfile(JSON.parse(content))
        })()
    }, [])

    function update(patch) {
        setProfile({ ...profile, ...patch })
    }

    async function handleSave() {
        setSaveStatus("saving")
        try {
            await saveProfile({ ...profile, noteId: ids.profileNoteId })
            await updateTaskLists(ids.profileNoteIds, ids.constants, ids.icalNoteId)
            setSaveStatus("saved")
        } catch (err) {
            setSaveStatus("failed")
            console.error(err)
        } finally {
            setTimeout(() => setSaveStatus(null), 1500)
        }
    }

    if (!profile || !ids) return <div>Loading...</div>

    const saveLabel = saveStatus === "saving" ? "Saving…"
        : saveStatus === "saved" ? "Saved!"
        : saveStatus === "failed" ? "Save failed"
        : "Save"

    return (
        <div className="profile-editor">
            <h2>Agenda Profile</h2>
            <div className="pe-field-row">
                <label>Name</label>
                <FormTextBox currentValue={profile.name} onChange={v => update({ name: v })} />
            </div>
            <div className="pe-field-row">
                <label>File Tasks Under</label>
                <NoteAutocomplete noteId={profile.parentNoteId} noteIdChanged={v => update({ parentNoteId: v })} />
            </div>

            <SearchGroupsEditor searchGroups={profile.searchGroups} onChange={searchGroups => update({ searchGroups })} />
            <FilterGroupsEditor filterGroups={profile.filterGroups} onChange={filterGroups => update({ filterGroups })} />
            <SortsEditor sorts={profile.sorts} onChange={sorts => update({ sorts })} />
            <PrefixesEditor prefixes={profile.prefixes} onChange={prefixes => update({ prefixes })} />
            <ColorsEditor colors={profile.colors} onChange={colors => update({ colors })} />

            <div className="pe-actions">
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveLabel}
                    onClick={handleSave}
                />
            </div>
        </div>
    )
}
