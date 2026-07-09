import { useState, useEffect, FormTextBox, NoteAutocomplete, Button } from "trilium:preact"
import { startNote, activateNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SearchGroupsEditor } from "profileEditorSearchGroups.jsx"
import { FilterGroupsEditor } from "profileEditorFilterGroups.jsx"
import { SortsEditor } from "profileEditorSorts.jsx"
import { PrefixesEditor } from "profileEditorPrefixes.jsx"
import { ColorsEditor } from "profileEditorColors.jsx"

const { loadData, saveProfile, updateTaskLists } = require("libAgendaOverview.js")

export default function ProfileEditor() {
    const [ids, setIds] = useState(null)
    const [registry, setRegistry] = useState(null)
    const [profile, setProfile] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const { constants, profileContext } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            const profileId = profileContext.profileIds[0]
            const data = await loadData(profileContext.dataNoteId, profileContext.builtinElementsNoteId)
            setIds({ constants, profileContext, profileId, icalNoteId })
            setRegistry(data)
            setProfile({
                id: profileId,
                dataNoteId: profileContext.dataNoteId,
                builtinElementsNoteId: profileContext.builtinElementsNoteId,
                ...data.profiles[profileId]
            })
        })()
    }, [])

    function update(patch) {
        setProfile({ ...profile, ...patch })
    }

    async function handleSave() {
        setSaveStatus("saving")
        try {
            await saveProfile(profile)
            await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
            setRegistry(await loadData(ids.profileContext.dataNoteId, ids.profileContext.builtinElementsNoteId))
            setSaveStatus("saved")
        } catch (err) {
            setSaveStatus("failed")
            console.error(err)
        } finally {
            setTimeout(() => setSaveStatus(null), 1500)
        }
    }

    async function openElementLibrary() {
        const elementLibraryNoteId = await startNote.getRelationValue("elementLibraryNote")
        if (elementLibraryNoteId) await activateNote(elementLibraryNoteId)
    }

    if (!profile || !registry || !ids) return <div>Loading...</div>

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

            <SearchGroupsEditor
                searchGroups={profile.searchGroups}
                registry={registry}
                onChange={searchGroups => update({ searchGroups })}
                onOpenLibrary={openElementLibrary}
            />
            <FilterGroupsEditor
                filterGroups={profile.filterGroups}
                registry={registry}
                onChange={filterGroups => update({ filterGroups })}
                onOpenLibrary={openElementLibrary}
            />
            <SortsEditor
                sorts={profile.sorts}
                registry={registry}
                onChange={sorts => update({ sorts })}
                onOpenLibrary={openElementLibrary}
            />
            <PrefixesEditor
                prefixes={profile.prefixes}
                registry={registry}
                onChange={prefixes => update({ prefixes })}
                onOpenLibrary={openElementLibrary}
            />
            <ColorsEditor
                colors={profile.colors}
                registry={registry}
                onChange={colors => update({ colors })}
                onOpenLibrary={openElementLibrary}
            />

            <div className="pe-actions">
                <Button icon="bx-library" text="Element Library" onClick={openElementLibrary} />
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveLabel}
                    onClick={handleSave}
                />
            </div>
        </div>
    )
}
