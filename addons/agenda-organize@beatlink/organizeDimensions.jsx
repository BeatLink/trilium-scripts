import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

const { getOrganizeConfigIds } = require("organizeSettings.js")

// The Dimensions settings panel, editing Organize's own `dimensions` registry in
// #agendaOrganizeConfig. The registry drives the triage queues, the root-note
// axis check, and the value pickers.
//
// Item TYPE is not a dimension here — it's owned entirely by
// template-picker@beatlink's own registry (its ~template relation, not a #type
// label), so there is no "Match Templates By Name" step on this panel.
//
// agenda-overview@beatlink keeps its own separate registry of the same shape for the
// Overview's derived prefix/color/grouping/filter variants. The two are edited
// independently and neither addon reads the other's config note, so a vocabulary
// you want in both places is entered in both places.
export function DimensionsPanel() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => {
            setIds(await getOrganizeConfigIds())
        })()
    }, [])

    if (ids === undefined) return <div><LoadingSpinner /> Loading...</div>
    if (ids === null) {
        return (
            <div className="organize-dimensions">
                <p className="organize-dimensions-blurb">
                    Organize's settings note isn't discoverable, so there are no dimensions to edit
                    here. Reinstalling the addon restores it.
                </p>
            </div>
        )
    }

    return (
        <div className="organize-dimensions">
            <p className="organize-dimensions-blurb">
                The classification axes notes are tagged with. Each dimension is one note label plus
                its ordered vocabulary of values. Adding a dimension gives you a triage queue and its
                value pickers, with no further setup. The order of a dimension's values sets the order
                they appear in.
            </p>
            <p className="organize-dimensions-warning">
                Changing a value's <strong>Key</strong> orphans every note already tagged with the old
                one. Renaming its <strong>Name</strong> or reordering the list is safe. A dimension
                that <strong>scaffolds a root note per value</strong> (Area) shapes the notebook
                roots the queues expect. Item type is assigned via template-picker@beatlink's own widget,
                not a dimension here. agenda-overview@beatlink reads its own separate dimensions
                registry, so a change here does not reach it.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                only="Dimensions"
            />
        </div>
    )
}
