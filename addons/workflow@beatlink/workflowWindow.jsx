import { useState } from "trilium:preact"
import OrganizePanel from "workflowOrganizePanel.jsx"

// The Workflow window: a single render page split into the four phases of the
// Collect -> Organize -> Review -> Execute workflow, one tab each. Organize is
// wired (the assign-a-template triage queue); the others are placeholders for
// now (see develop.md's roadmap).
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
        blurb: "Work through every untemplated note under your Inbox and Areas, one at a time, and " +
            "give each a type. Further attributes (priority, area, dates) follow."
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
                {phase === "organize" ? (
                    <OrganizePanel />
                ) : (
                    <div className="workflow-window-placeholder">
                        Coming soon — this phase is scaffolded but not yet wired. See the roadmap in the
                        addon's develop.md.
                    </div>
                )}
            </div>
        </div>
    )
}
