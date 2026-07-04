// Parse "priority:desc;area;title:caseInsensitive" into an array of criteria objects
function parseSortCriteria(sortString) {
    return sortString.split(";").map(segment => {
        const parts = segment.trim().split(":");
        const attribute = parts[0].trim();
        const flags = parts.slice(1).map(f => f.trim());
        return {
            attribute,
            desc: flags.includes("desc"),
            caseInsensitive: flags.includes("caseInsensitive")
        };
    }).filter(c => c.attribute);
}

const BUILTINS = new Set(["noteId", "title", "dateCreated", "dateModified"]);

// Get a comparable value for a note attribute (builtin or label)
function getValue(note, attribute) {
    if (BUILTINS.has(attribute)) {
        return note[attribute] ?? "";
    }
    return note.getLabelValue(attribute) ?? "";
}

// Sort an array of notes by multiple criteria; returns a new sorted array
function sortChildNotes(sortString, childNotes) {
    const criteria = parseSortCriteria(sortString);

    return [...childNotes].sort((a, b) => {
        for (const { attribute, desc, caseInsensitive } of criteria) {
            let valA = getValue(a, attribute);
            let valB = getValue(b, attribute);

            if (caseInsensitive) {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
            if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
    });
}

module.exports = { parseSortCriteria, sortChildNotes };
