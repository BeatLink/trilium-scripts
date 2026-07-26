import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

const { provisionStructure } = require("provision.js")
const { getStructureConfigIds } = require("structureSettings.js")
const { getDimensions } = require("dimensions.js")

// The Setup UI for the notebook structure. Split out of agenda-organize's editor
// so provisioning (a one-shot scaffold) and triage (the day-to-day Organize page)
// are separately installable.
//
// Re-runnable and idempotent — notes you already made by hand at the right title
// and level are adopted (tagged) rather than duplicated. See provision.js.
function WorkflowSetup() {
    const [running, setRunning] = useState(false)
    const [outcome, setOutcome] = useState(null)
    const [error, setError] = useState(null)

    async function onProvision() {
        setRunning(true)
        setError(null)
        setOutcome(null)
        try {
            setOutcome(await provisionStructure(await getDimensions()))
        } catch (e) {
            setError(String(e && e.message ? e.message : e))
        } finally {
            setRunning(false)
        }
    }

    const results = outcome ? outcome.results : null
    const migratedAreaCount = outcome ? outcome.migratedAreaCount : 0
    const labelMigration = outcome ? outcome.labelMigration : null
    const created = results ? results.filter(r => r.created).length : 0
    const adopted = results ? results.filter(r => r.adopted).length : 0
    const existing = results ? results.filter(r => !r.created && !r.adopted).length : 0

    return (
        <div className="workflow-setup">
            <p className="workflow-setup-blurb">
                Provision the notebook structure: <strong>Inbox</strong>, <strong>My Day</strong>,
                <strong> Agenda</strong>, one top-level note per Area (from the dimension that
                scaffolds areas) and one top-level note per enabled template. Both sets are one
                level deep — an item is filed in two places at once, its Area and its Type, as a
                clone. Notes are matched by title at the top level — an existing match is adopted
                (tagged <code>#agendaOrganizeArea</code> / <code>#agendaOrganizeType</code>) rather
                than duplicated, and anything missing is created.
                Only containers are provisioned here; filing items into them is the Organize page's
                job. Also re-keys any notes left on an old area slug after an area reorder. Safe to
                run more than once.
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
                        {labelMigration && labelMigration.migrated > 0 &&
                            ` Converted ${labelMigration.migrated} structural note${labelMigration.migrated === 1 ? "" : "s"} to the split identity labels.`}
                        {labelMigration && labelMigration.unparsed.length > 0 &&
                            ` ${labelMigration.unparsed.length} legacy key${labelMigration.unparsed.length === 1 ? "" : "s"} could not be parsed and were left as-is.`}
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

export default function StructureEditor() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => setIds(await getStructureConfigIds()))()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) return <div>Structure's configuration isn't discoverable.</div>

    // Setup is a button, not a settable value, so it comes in as an extra panel
    // rather than a schema key.
    const extraPanels = [
        {
            category: "Structure",
            tab: "Workflow Setup",
            render: () => <WorkflowSetup />
        }
    ]

    return (
        <div className="profile-editor">
            <h2>Structure Editor</h2>
            <p>
                Provision the notebook structure from Structure › Workflow Setup. The Area
                vocabulary comes from agenda@beatlink's dimensions registry and the Type vocabulary
                from template-picker@beatlink's template registry; edit those in their own addons.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
