import { render, useState, useEffect } from "trilium:preact"
import { currentNote } from "trilium:api"

const CONFIG_RELATION = "AddonData:config"

async function loadConfig() {
    const configNote = await currentNote.getRelationTarget(CONFIG_RELATION)
    const content = await api.runOnBackend(
        (id) => api.getNote(id).getContent(),
        [configNote.noteId]
    )
    return { config: JSON.parse(content), configNoteId: configNote.noteId }
}

async function saveConfig(configNoteId, config) {
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [configNoteId, JSON.stringify(config, null, 4)]
    )
}

function LauncherItem({ launcher, index, total, onChange, onRemove, onMove }) {
    return (
        <div class="lnch-item">
            <div class="lnch-item-fields">
                <label class="lnch-field">
                    <span>Icon</span>
                    <div class="lnch-icon-input">
                        <input
                            type="text"
                            value={launcher.icon}
                            placeholder="bx bx-star"
                            onInput={e => onChange(index, "icon", e.target.value)}
                        />
                        <i class={launcher.icon || "bx bx-star"}></i>
                    </div>
                </label>
                <label class="lnch-field">
                    <span>Label</span>
                    <input
                        type="text"
                        value={launcher.label}
                        placeholder="Now"
                        onInput={e => onChange(index, "label", e.target.value)}
                    />
                </label>
                <label class="lnch-field">
                    <span>Parent Note ID</span>
                    <input
                        type="text"
                        value={launcher.parentNoteId}
                        placeholder="Note ID"
                        onInput={e => onChange(index, "parentNoteId", e.target.value)}
                    />
                </label>
            </div>
            <div class="lnch-item-controls">
                <button
                    class="lnch-ctrl-btn"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                >
                    <i class="bx bx-chevron-up"></i>
                </button>
                <button
                    class="lnch-ctrl-btn"
                    onClick={() => onMove(index, 1)}
                    disabled={index === total - 1}
                    title="Move down"
                >
                    <i class="bx bx-chevron-down"></i>
                </button>
                <button
                    class="lnch-ctrl-btn lnch-remove-btn"
                    onClick={() => onRemove(index)}
                    title="Remove"
                >
                    <i class="bx bx-x"></i>
                </button>
            </div>
        </div>
    )
}

function SettingsUI() {
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
        await saveConfig(configNoteId, updatedConfig)
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
            launchers: [...config.launchers, { label: "", icon: "bx bx-star", parentNoteId: "" }]
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
        <div class="lnch-settings">
            <h3>Launchers</h3>

            <section class="lnch-section">
                <h4>Global Options</h4>
                <label class="lnch-toggle-row">
                    <input
                        type="checkbox"
                        checked={config.exclusive}
                        onChange={e => setConfig({ ...config, exclusive: e.target.checked })}
                    />
                    <div>
                        <span>Exclusive mode</span>
                        <small>When adding to a parent, automatically remove from all other configured parents first</small>
                    </div>
                </label>

                <label class="lnch-select-row">
                    <span>Widget placement</span>
                    <select
                        value={config.placement}
                        onChange={e => setConfig({ ...config, placement: e.target.value })}
                    >
                        <option value="right-pane">Right pane</option>
                        <option value="left-pane-launcher">Left pane launcher</option>
                    </select>
                </label>

                {config.placement === "left-pane-launcher" && (
                    <div class="lnch-notice">
                        <i class="bx bx-info-circle"></i>
                        <p>Reload the UI after saving for the placement change to take effect.</p>
                    </div>
                )}
            </section>

            <section class="lnch-section">
                <h4>Launchers</h4>
                {config.launchers.length === 0 && (
                    <p class="lnch-empty">No launchers configured. Add one below.</p>
                )}
                <div class="lnch-list">
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
                <button class="lnch-add-btn" onClick={addLauncher}>
                    <i class="bx bx-plus"></i> Add Launcher
                </button>
            </section>

            <div class="lnch-actions">
                <button
                    class={`lnch-save-btn ${saveStatus === "saved" ? "lnch-saved" : ""}`}
                    onClick={() => save(config)}
                >
                    <i class={`bx ${saveStatus === "saved" ? "bx-check" : "bx-save"}`}></i>
                    {saveStatus === "saved" ? "Saved!" : "Save"}
                </button>
            </div>
        </div>
    )
}

render(<SettingsUI />, $widget[0])
