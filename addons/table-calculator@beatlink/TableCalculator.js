const { loadSettings } = libsettings

let schemaNoteId = api.currentNote.getRelationValue("schemaNote")
let settingsNoteId = api.currentNote.getRelationValue("settingsNote")
let configNoteId = api.getNote(settingsNoteId).getRelationValue("AddonData:config")

let settings = loadSettings(schemaNoteId, configNoteId)

const regexPattern = /[^0-9.-]+/g

function computeSum(node, attribute, formatter) {
    // If node has no children, save and pass it up
    if (!node.hasChildren()) {
        let value = node.getLabelValue(attribute)
        value = parseFloat(value ? value.replace(regexPattern, '') : 0);
        let formattedValue = formatter.format(value)
        node.setLabel(attribute, formattedValue)
        return value;
    } else {
        // If node has children, get their totals, sum and save
        let children = node.getChildNotes()
        let total = children.reduce((sum, child) => sum + computeSum(child, attribute, formatter), 0);
        let formattedTotal = formatter.format(total)
        node.setLabel(attribute, formattedTotal)
        return total;
    }
}

for (const profile of (settings.profiles || [])) {
    if (!(profile.tableNoteId && profile.attribute)) continue
    const formatter = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: profile.currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    computeSum(api.getNote(profile.tableNoteId), profile.attribute, formatter)
}
