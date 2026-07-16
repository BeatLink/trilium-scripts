import { loadSettings } from "libSettingsUI.jsx"

// Discover the area vocabulary from area-picker@beatlink and normalize it to the
// { slug, name, color } shape the Organize code uses internally. area-picker
// tags its settings note with #areaConfig (like agenda's #agendaConfig); that
// note relates to the schema note (schemaNote) and, via AddonData:config, to the
// config note. loadSettings merges the two and returns { areas: [{ key, title,
// color }] }, where key is the #area slug (e.g. "01-career").
//
// Returns [] when area-picker isn't installed / discoverable, so the Organize
// UI degrades to an empty area list rather than throwing.
export async function getAreaSettings() {
    const anchors = await api.searchForNotes("#areaConfig")
    if (!anchors.length) return []
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    if (!schemaNoteId || !configNoteId) return []

    const settings = await loadSettings(schemaNoteId, configNoteId)
    const areas = settings.areas || []
    return areas.map(a => ({ slug: a.key, name: a.title, color: a.color }))
}
