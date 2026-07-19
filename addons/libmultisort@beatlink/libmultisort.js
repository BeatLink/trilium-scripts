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

// Get a comparable value for a note attribute (builtin or label).
//
// `valueMaps` optionally supplies a per-attribute { labelValue -> ordinal } map,
// so an attribute whose values carry no intrinsic order can still sort by a
// caller-defined one. Its use case is a vocabulary whose display order lives in
// config rather than in the stored value (agenda's #area, whose values are
// stable slugs like "career" — sorting those as strings gives alphabetical, not
// the configured area order). A value missing from the map sorts after every
// mapped one, so unknown/retired values collect at the end instead of
// interleaving. Callers that pass no map (multisort@beatlink) are unaffected.
function getValue(note, attribute, valueMaps) {
    if (BUILTINS.has(attribute)) {
        return note[attribute] ?? "";
    }
    const raw = note.getLabelValue(attribute) ?? "";
    const map = valueMaps && valueMaps[attribute];
    if (map) return map[raw] ?? Number.MAX_SAFE_INTEGER;
    return raw;
}

// Sort an array of notes by multiple criteria; returns a new sorted array.
// See getValue for `valueMaps`.
function sortChildNotes(sortString, childNotes, valueMaps) {
    const criteria = parseSortCriteria(sortString);

    return [...childNotes].sort((a, b) => {
        for (const { attribute, desc, caseInsensitive } of criteria) {
            let valA = getValue(a, attribute, valueMaps);
            let valB = getValue(b, attribute, valueMaps);

            // Mapped values are numeric ordinals; only string values fold case.
            if (caseInsensitive && typeof valA === "string" && typeof valB === "string") {
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
