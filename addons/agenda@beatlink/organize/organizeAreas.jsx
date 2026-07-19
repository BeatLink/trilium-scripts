import { useState, useEffect } from "trilium:preact"
import { loadSettings, SettingsForm } from "libSettingsUI.jsx"

// Resolve area-picker@beatlink's settings note ids. area-picker tags its
// settings note with #areaConfig (like agenda's #agendaConfig); that note
// relates to the schema note (schemaNote) and, via AddonData:config, to the
// config note.
//
// Returns null when area-picker isn't installed / discoverable, so callers can
// degrade instead of throwing.
export async function getAreaConfigIds() {
    const anchors = await api.searchForNotes("#areaConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// Discover the area vocabulary from area-picker@beatlink and normalize it to the
// { slug, name, color } shape the Organize code uses internally. loadSettings
// merges schema + config and returns { areas: [{ key, title, color }] }, where
// key is the #area slug — a stable, order-free identifier (e.g. "career").
//
// Returns [] when area-picker isn't installed / discoverable, so the Organize
// UI degrades to an empty area list rather than throwing.
export async function getAreaSettings() {
    const ids = await getAreaConfigIds()
    if (!ids) return []

    const settings = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    const areas = settings.areas || []
    return areas.map(a => ({ slug: a.key, name: a.title, color: a.color }))
}

// The Areas settings panel: area-picker's own `areas` list editor, surfaced
// inside agenda's Organize page so the vocabulary the workflow scaffolds from
// can be edited without leaving it.
//
// This edits AREA-PICKER's config note, not agenda's — the two addons share the
// vocabulary by discovery, and duplicating it here would let the two drift. So
// the panel is deliberately thin: it resolves area-picker's note ids and hands
// them to the same SettingsForm area-picker's own settings page uses, scoped to
// the `areas` key.
//
// Renaming an area's Title is safe, as is reordering the list — keys are stable
// and carry no ordering, so neither rewrites a note. Changing a Key is not: it's
// the #area value stored on every tagged note, hence the warning.
// provisionStructure's migrateAreaSlugs repairs only values that resolve to a
// current area (after stripping a legacy "<NN>-" prefix and applying
// AREA_ALIASES).
export function AreasPanel() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => setIds(await getAreaConfigIds()))()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="organize-areas">
                <p className="organize-areas-blurb">
                    Area Picker isn't installed, so there's no area vocabulary to edit. Install{" "}
                    <code>area-picker@beatlink</code> to define the life areas this workflow
                    scaffolds a notebook section for.
                </p>
            </div>
        )
    }

    return (
        <div className="organize-areas">
            <p className="organize-areas-blurb">
                The life areas the Organize workflow scaffolds a notebook section for — one Area note
                per entry, each holding a bucket per enabled template. This is{" "}
                <strong>Area Picker's</strong> configuration, shared with its dropdown widget and every
                note tagged <code>#area</code>. The order of this list sets the order areas appear in,
                both in the picker and in area-sorted views; keys are stable and never rewritten by a
                reorder.
            </p>
            <p className="organize-areas-warning">
                Renaming an area's <strong>Title</strong> is safe — the next Workflow Setup run re-keys
                its notes and folds its buckets by name. Changing a <strong>Key</strong> is not: the key
                is the <code>#area</code> value stored on every tagged note, and editing it orphans
                them.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                only="Areas"
            />
        </div>
    )
}
