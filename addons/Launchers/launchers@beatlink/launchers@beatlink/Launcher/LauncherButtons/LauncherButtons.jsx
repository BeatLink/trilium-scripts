import { useState, useEffect } from "trilium:preact"
import { getActiveContextNote } from "trilium:api"

const { loadConfig, getActiveParents, toggleLauncher } = require("libjs")

function LauncherButtons({ configNote, noteId, variant }) {
    const [config, setConfig] = useState(null)
    const [activeParents, setActiveParents] = useState([])

    useEffect(async () => {
        if (!configNote) return
        setConfig(await loadConfig(configNote))
    }, [configNote?.noteId])

    useEffect(() => {
        if (!noteId || !config?.launchers?.length) return
        const parentIds = config.launchers.map(l => l.parentNoteId)
        getActiveParents(noteId, parentIds).then(setActiveParents)
    }, [noteId, config])

    if (!config) return null
    if (variant === "right-pane" && config.placement !== "right-pane") return null
    if (variant === "launchbar" && config.placement !== "left-pane-launcher") return null
    if (!config.launchers?.length) return null

    async function handleClick(index) {
        const launcher = config.launchers[index]
        const isActive = activeParents[index] ?? false
        const activeNote = await getActiveContextNote()
        if (!activeNote) return
        await toggleLauncher(activeNote.noteId, launcher, config.launchers, config.exclusive, isActive)
        const updated = await getActiveParents(activeNote.noteId, config.launchers.map(l => l.parentNoteId))
        setActiveParents(updated)
    }

    if (variant === "launchbar") {
        return (
            <div style="display:contents">
                {config.launchers.map((launcher, i) => (
                    <button
                        key={i}
                        class={`launcher-button ${launcher.icon}${activeParents[i] ? " lnch-lb-active" : ""}`}
                        title={launcher.label}
                        onClick={() => handleClick(i)}
                    />
                ))}
            </div>
        )
    }

    return (
        <div class="lnch-buttons">
            {config.launchers.map((launcher, i) => (
                <button
                    key={i}
                    class={`lnch-btn ${activeParents[i] ? "lnch-btn-active" : ""}`}
                    onClick={() => handleClick(i)}
                    title={launcher.label}
                >
                    <i class={launcher.icon}></i>
                    <span>{launcher.label}</span>
                </button>
            ))}
        </div>
    )
}

module.exports = { LauncherButtons }
