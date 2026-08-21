import { render, useState, useEffect } from "trilium:preact"
import { currentNote } from "trilium:api"

// Shared async module loader, inlined in every entry-point script because it must work before any
// startup script has run; the first bundle to evaluate installs it and the rest reuse its cache.
globalThis.tamRequire ??= (() => {
    const cache = new Map()
    const CYCLE_TIMEOUT_MS = 10000
    return (tamFileId) => {
        if (!cache.has(tamFileId)) {
            const load = (async () => {
                const note = await api.searchForNote(`#TAMFILEID="${tamFileId}"`)
                if (!note) throw new Error(`tamRequire: no note tagged #TAMFILEID="${tamFileId}"`)
                const exports = await note.executeScript()
                if (exports === undefined) throw new Error(`tamRequire: "${tamFileId}" failed to load, see the error toast`)
                return exports
            })()
            // A circular require would deadlock on the promise cache forever, so fail loudly instead.
            let timer
            const guard = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`tamRequire: "${tamFileId}" unresolved after ${CYCLE_TIMEOUT_MS}ms, likely a circular require`)), CYCLE_TIMEOUT_MS)
            })
            cache.set(tamFileId, Promise.race([load, guard]).finally(() => clearTimeout(timer)))
        }
        return cache.get(tamFileId)
    }
})()

const { loadConfig, saveConfig } = await tamRequire("togglenotes@beatlink/config-js")
import {
    ActionButton,
    Button,
    Admonition,
    FormCheckbox,
    FormDropdownList,
    FormTextBox,
    FormGroup,
    FormToggle,
    NoteAutocomplete
} from "trilium:preact"

const PLACEMENTS = [
    { key: "right-pane", name: "Right pane" },
    { key: "left-pane-launcher", name: "Left pane launcher" }
]

function LauncherItem({ launcher, index, total, onChange, onRemove, onMove }) {
    return (
        <div class="item">
            <div class="field">
                <NoteAutocomplete
                    placeholder="Parent Note"
                    noteId={launcher.parentNoteId}
                    noteIdChanged={e => onChange(index, "parentNoteId", e)}
                />
            </div>
            <div class="controls">
                <Button
                    icon="bx bx-chevron-up"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                />
                <Button
                    icon="bx bx-chevron-down"
                    onClick={() => onMove(index, 1)}
                    disabled={index === total - 1}
                />
                <Button
                    icon="bx bx-x"
                    onClick={() => onRemove(index)}
                />
            </div>
        </div>
    )
}

export default function SettingsUI() {
    const [config, setConfig] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const { config, configNoteId } = await loadConfig()
            setConfig(config)
            setConfigNoteId(configNoteId)
        })()
    }, [])

    async function save(updatedConfig) {
        await saveConfig(updatedConfig)
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus(null), 2000)
    }

    function updateLauncher(index, field, value) {
        const launchers = config.launchers.map((l, i) =>
            i === index ? { ...l, [field]: value } : l
        )
        setConfig({ ...config, launchers })
    }

    function addLauncher() {
        setConfig({
            ...config,
            launchers: [...config.launchers, { parentNoteId: "" }]
        })
    }

    function removeLauncher(index) {
        setConfig({
            ...config,
            launchers: config.launchers.filter((_, i) => i !== index)
        })
    }

    function moveLauncher(index, direction) {
        const launchers = [...config.launchers]
        const target = index + direction
        if (target < 0 || target >= launchers.length) return;
        [launchers[index], launchers[target]] = [launchers[target], launchers[index]]
        setConfig({ ...config, launchers })
    }

    if (!config) return <div class="lnch-settings lnch-loading">Loading...</div>

    return (
        <div class="launcher-settings">
            <h3>ToggleNote Settings</h3>
            <section>
                <h4>Exclusive Mode</h4>
                <label>When adding to a parent, automatically remove from all other configured parents first</label>
                <FormToggle
                    switchOnName="Off"
                    switchOffName="On"
                    currentValue={config.exclusive}
                    onChange={e => setConfig({ ...config, exclusive: e })}
                /> 
            </section>
            <section>
                <h4>Launcher Placement</h4>
                <label>Sets where the launcher buttons are displayed</label>
                <FormDropdownList
                    currentValue={config.placement}
                    values={PLACEMENTS}
                    keyProperty="key" titleProperty="name"
                    onChange={e => setConfig({ ...config, placement: e })}
                />
                {config.placement === "left-pane-launcher" && (
                    <Admonition type="note" title="Placement change">
                        Reload the UI after saving for the placement change to take effect.
                    </Admonition>
                )}
            </section>
            <section>
                <h4>Launchers</h4>
                {config.launchers.length === 0 && (
                    <p>No launchers configured. Add one below.</p>
                )}
                <div class="item-list">
                    {config.launchers.map((launcher, i) => (
                        <LauncherItem
                            key={i}
                            launcher={launcher}
                            index={i}
                            total={config.launchers.length}
                            onChange={updateLauncher}
                            onRemove={removeLauncher}
                            onMove={moveLauncher}
                        />
                    ))}
                </div>
                <Button icon="bx-plus" text="Add Launcher" onClick={addLauncher} />
            </section>
            <div class="list-controls">
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveStatus === "saved" ? "Saved!" : "Save"}
                    onClick={() => save(config)}
                />
            </div>
        </div>
    )
}
