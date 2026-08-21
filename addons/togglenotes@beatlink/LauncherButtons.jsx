import { useState, useEffect, useNoteContext, useNoteProperty, Button } from "trilium:preact"
const { loadConfig, getActiveParents, getLauncherInfo, toggleLauncher } = await tamRequire("togglenotes@beatlink/lib-js")

function LauncherButtons({ variant }) {
    const { note } = useNoteContext();
    const currentNoteId = useNoteProperty(note, "noteId");
    const [placement, setPlacement] = useState(null)
    const [launchers, setLaunchers] = useState([])
    const [activeParents, setActiveParents] = useState([])

    useEffect(() => {
        (async () => {
            const { config } = await loadConfig()
            setPlacement(config?.placement ?? null)
            if (config?.launchers?.length) {
                const parentIds = config.launchers.map(l => l.parentNoteId)
                setLaunchers(await getLauncherInfo(parentIds))
            }
        })()
    }, [])

    useEffect(() => {
        if (!currentNoteId || !launchers.length) return
        refreshActiveParents(currentNoteId)
    }, [currentNoteId, launchers])

    async function refreshActiveParents(noteId) {
        const parentIds = launchers.map(l => l.parentNoteId)
        setActiveParents(await getActiveParents(noteId, parentIds))
    }

    async function handleClick(index) {
        const launcher = launchers[index]
        const isActive = activeParents[index] ?? false
        if (!note) return
        const { config } = await loadConfig()
        await toggleLauncher(currentNoteId, launcher, launchers, config.exclusive, isActive)
        await refreshActiveParents(currentNoteId)
    }

    const isLaunchbar = variant === "launchbar"
    const expectedPlacement = isLaunchbar ? "left-pane-launcher" : "right-pane"

    if (!launchers.length || placement !== expectedPlacement) return null

    if (isLaunchbar) {
        return (
            <div style="display:contents">
                {launchers.map((launcher, i) => (
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
        <div class="launcher-buttons">
            {launchers.map((launcher, i) => (
                <Button
                    key={i}
                    onClick={() => handleClick(i)}
                    text={launcher.label}
                    icon={launcher.icon}
                />
            ))}
        </div>
    )
}

module.exports = { LauncherButtons }