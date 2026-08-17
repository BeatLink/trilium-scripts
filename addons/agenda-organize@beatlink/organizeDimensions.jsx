import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

const { getAgendaConfigIds } = require("organizeSettings.js")

// The Dimensions settings panel. This is the single source of truth for the
// classification axes — area and priority ship as defaults, but the set is
// open-ended. Editing here drives the triage queues, the notebook scaffolding,
// and the derived prefix/color/grouping/filter variants all at once.
//
// Item TYPE is no longer a dimension here — it's owned entirely by
// template-picker@beatlink's own registry (its ~template relation, not a #type
// label), so there is no "Match Templates By Name" step on this panel any more.
//
// The registry lives in agenda@beatlink's #agendaConfig, NOT in this addon's own
// #agendaOrganizeConfig: agenda's Overview derives its prefix/color/grouping/
// filter variants from the same list these queues write to, so a local copy
// would silently drift. Renders an explanatory note when agenda isn't installed.
export function DimensionsPanel() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => {
            setIds(await getAgendaConfigIds())
        })()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="organize-dimensions">
                <p className="organize-dimensions-blurb">
                    The dimensions registry lives in agenda@beatlink, which isn't installed or whose
                    configuration isn't discoverable, so there are no dimensions to edit here.
                </p>
            </div>
        )
    }

    return (
        <div className="organize-dimensions">
            <p className="organize-dimensions-blurb">
                The classification axes notes are tagged with. Each dimension is one note label plus
                its ordered vocabulary of values. Adding a dimension gives you an Organize triage
                queue, a sort ordinal, and a derived prefix/color/grouping/filter variant, with no
                further setup. The order of a dimension's values sets the order they sort and appear
                in.
            </p>
            <p className="organize-dimensions-warning">
                Changing a value's <strong>Key</strong> orphans every note already tagged with the old
                one. Renaming its <strong>Name</strong> or reordering the list is safe. A dimension
                that <strong>scaffolds a root note per value</strong> (Area) shapes the notebook
                roots the queues expect. Item type is assigned via template-picker@beatlink's own widget,
                not a dimension here.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                only="Dimensions"
            />
        </div>
    )
}
