import { useState } from "trilium:preact"

const { provisionStructure } = require("organizeProvision.js")

// The Setup page — a render page separate from the main Workflow window. Its one
// job: a button that provisions the opinionated notebook structure (Inbox, My
// Day, Agenda, and the 13 Areas each with their six Type subnotes) by
// find-or-create, tagging every note with #workflowNote=<key>. Re-runnable and
// idempotent: notes you already created by hand at the right title/level are
// adopted (tagged) rather than duplicated. See organizeProvision.js.
export default function WorkflowSetup() {
    const [running, setRunning] = useState(false)
    const [outcome, setOutcome] = useState(null)
    const [error, setError] = useState(null)

    async function onProvision() {
        setRunning(true)
        setError(null)
        setOutcome(null)
        try {
            setOutcome(await provisionStructure())
        } catch (e) {
            setError(String(e && e.message ? e.message : e))
        } finally {
            setRunning(false)
        }
    }

    const results = outcome ? outcome.results : null
    const migratedAreaCount = outcome ? outcome.migratedAreaCount : 0
    const created = results ? results.filter(r => r.created).length : 0
    const adopted = results ? results.filter(r => r.adopted).length : 0
    const existing = results ? results.filter(r => !r.created && !r.adopted).length : 0

    return (
        <div className="workflow-setup">
            <h2>Workflow Setup</h2>
            <p className="workflow-setup-blurb">
                Provision the notebook structure: <strong>Inbox</strong>, <strong>My Day</strong>,
                <strong> Agenda</strong>, and one note per Area (each with Ideas / Goals / Routines /
                Projects / Future / Notes below it). Notes are matched by title at the right level — an
                existing match is adopted (tagged <code>#workflowNote</code>) rather than duplicated,
                and anything missing is created. Also re-keys any notes left on an old area slug after
                an area reorder. Safe to run more than once.
            </p>

            <button
                className="workflow-setup-button"
                disabled={running}
                onClick={onProvision}
            >
                {running ? "Provisioning..." : "Provision structure"}
            </button>

            {error && (
                <div className="workflow-setup-error">Provisioning failed: {error}</div>
            )}

            {results && (
                <div className="workflow-setup-results">
                    <div className="workflow-setup-summary">
                        {created} created, {adopted} adopted, {existing} already present
                        ({results.length} total).
                        {migratedAreaCount > 0 &&
                            ` Migrated ${migratedAreaCount} note${migratedAreaCount === 1 ? "" : "s"} to updated area slugs.`}
                    </div>
                    <ul className="workflow-setup-log">
                        {results.map(r => (
                            <li key={r.key} style={{ marginLeft: `${r.depth * 16}px` }}>
                                <span className={
                                    "workflow-setup-tag workflow-setup-tag-" +
                                    (r.created ? "created" : r.adopted ? "adopted" : "existing")
                                }>
                                    {r.created ? "created" : r.adopted ? "adopted" : "present"}
                                </span>
                                {r.title}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
