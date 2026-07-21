import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { matchTemplatesByName } = require("dimensions.js")

// The Dimensions settings panel, surfaced in agenda's Organize page. This is the
// single source of truth for agenda's classification axes — area, type and
// priority ship as defaults, but the set is open-ended. Editing here drives the
// Task-pane pickers, the triage queues, the notebook scaffolding, and the
// derived prefix/color/grouping/filter variants all at once.
//
// It edits agenda's OWN #agendaConfig (unlike the old Areas/Templates panels,
// which reached into three separate picker addons). "Match Templates By Name"
// fills each type value's Template Note by matching its Name against a #template
// note's title — note ids are install-specific so they can't ship as defaults.
export function DimensionsPanel() {
    const [ids, setIds] = useState(undefined)
    const [matching, setMatching] = useState(false)
    const [matchResult, setMatchResult] = useState("")

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            setIds(settings
                ? { schemaNoteId: settings.schemaNoteId, configNoteId: settings.configNoteId }
                : null)
        })()
    }, [])

    async function runMatch() {
        setMatching(true)
        setMatchResult("")
        try {
            const count = await matchTemplatesByName()
            setMatchResult(count
                ? `Matched ${count} value${count === 1 ? "" : "s"} to a template note.`
                : "No blank template notes matched a #template title.")
        } finally {
            setMatching(false)
        }
    }

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="organize-dimensions">
                <p className="organize-dimensions-blurb">
                    Agenda's configuration isn't discoverable, so there are no dimensions to edit.
                </p>
            </div>
        )
    }

    return (
        <div className="organize-dimensions">
            <p className="organize-dimensions-blurb">
                The classification axes notes are tagged with. Each dimension is one note label plus
                its ordered vocabulary of values. Adding a dimension gives you a Task-pane picker, an
                Organize triage queue, a sort ordinal, and a derived prefix/color/grouping/filter
                variant, with no further setup. The order of a dimension's values sets the order they
                sort and appear in.
            </p>
            <p className="organize-dimensions-warning">
                Changing a value's <strong>Key</strong> orphans every note already tagged with the old
                one. Renaming its <strong>Name</strong> or reordering the list is safe. A dimension
                that <strong>scaffolds a root note per value</strong> (Area) or a{" "}
                <strong>bucket per value</strong> (Type) shapes the notebook Workflow Setup builds.
            </p>
            <div className="organize-dimensions-match">
                <button className="workflow-organize-option-btn" disabled={matching} onClick={runMatch}>
                    {matching ? "Matching..." : "Match Templates By Name"}
                </button>
                {matchResult && <span className="organize-dimensions-match-result">{matchResult}</span>}
            </div>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                only="Dimensions"
            />
        </div>
    )
}
