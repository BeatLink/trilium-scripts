import { useState } from "trilium:preact"

// The Workflow window: a single render page split into the four phases of the
// Capture -> Organize -> Review -> Execute workflow, one tab each. Each phase
// is a placeholder for now (see develop.md's roadmap) — the tab shell and phase
// scaffolding land first; each panel gets wired to the agenda engine + the
// provisioned notebook in later phases.
//
// Tab styling mirrors agenda's taskView.jsx (lst-tab / lst-tab-active), so the
// window reads as native Trilium chrome.
const PHASES = [
    {
        key: "collect",
        label: "Collect",
        heading: "Collect",
        blurb: "Process your inboxes into the Inbox note: email, bookmarks, digital files, notes, " +
            "chat messages, photos, physical documents, work systems, browser tabs. Capture the raw " +
            "item here; attributes are set later, in Organize."
    },
    {
        key: "organize",
        label: "Organize",
        heading: "Organize",
        blurb: "Set each item's area and type, plus priority (MoSCoW), status, context, effort, and " +
            "dates, then file it into the notebook tree under the right Area and Type."
    },
    {
        key: "review",
        label: "Review",
        heading: "Review",
        blurb: "Daily: Must Do plus overdue, sorted by date. Weekly: sweep by Area to catch drift. " +
            "Review views: All Tasks / By Type / By Priority / By Date."
    },
    {
        key: "execute",
        label: "Execute",
        heading: "Execute",
        blurb: "Work the daily list (Must Do + overdue, date-sorted). Filter by Context and Effort to " +
            "match what you can do right now. Update Status as work progresses; Blocked items drop " +
            "out of the daily list until unblocked."
    }
]

export default function WorkflowWindow() {
    const [phase, setPhase] = useState("collect")

    const active = PHASES.find(p => p.key === phase)

    return (
        <div className="workflow-window">
            <div className="workflow-window-tabs">
                {PHASES.map(p => (
                    <button
                        key={p.key}
                        className={"lst-tab" + (phase === p.key ? " lst-tab-active" : "")}
                        onClick={() => setPhase(p.key)}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            <div className="workflow-window-panel">
                <h2>{active.heading}</h2>
                <p className="workflow-window-blurb">{active.blurb}</p>
                <div className="workflow-window-placeholder">
                    Coming soon — this phase is scaffolded but not yet wired. See the roadmap in the
                    addon's develop.md.
                </div>
            </div>
        </div>
    )
}
