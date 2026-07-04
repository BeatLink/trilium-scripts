// Imports --------------------------------------------------------------------
import {
    defineWidget,
    useActiveNoteContext,
    FormTextBox,
    Button,
    useState,
    useEffect
} from "trilium:preact"

import {
    activateNote,
    currentNote
} from "trilium:api"


function Addon({addonId, addonData, onInstall, onDelete, onUpdate, onSelfUpdate, onEnable, isSelf}){
    return (
        <div  className="TAM-addon-div" key={addonId}>
            <div className="TAM-addon-info-div">
                <label>{addonData.name} by {addonData.author} ({addonData.installedVersion ?? addonData.latestVersion})</label>
                <label>{addonData.description}</label>
                <label>License: {addonData.license}</label>
            </div>
            <div className="TAM-addon-button-div">
                <Button
                    icon="bx bx-globe"
                    text="Home Page"
                    onClick={e => {
                         window.open(addonData.homepage, "_blank");
                    }}
                />
                {!addonData.installedVersion && <Button
                    icon="bx bx-download"
                    text="Install Addon"
                    onClick={e => {
                        onInstall(addonId)
                    }}
                />}
                {addonData.installedVersion && !isSelf && <Button
                    icon="bx bx-trash"
                    text="Delete Addon"
                    onClick={e => {
                        onDelete(addonId)
                    }}
                />}
                {addonData.installedVersion && <Button
                    icon={addonData.enabled ? "bx bx-x-circle" : "bx bx-check-circle"}
                    text={addonData.enabled ? "Disable Addon" : "Enable Addon"}
                    onClick={e => {
                        onEnable(addonId, !addonData.enabled)
                    }}
                />}
                {addonData.updateAvailable && !isSelf && <Button
                    icon="bx bx-sync"
                    text={`Update Addon (${addonData.latestVersion})`}
                    onClick={e => {
                        onUpdate(addonId)
                    }}
                />}
                {addonData.updateAvailable && isSelf && <Button
                    icon="bx bx-sync"
                    text={`Self-Update (${addonData.latestVersion})`}
                    onClick={e => {
                        onSelfUpdate(addonId)
                    }}
                />}
            </div>
        </div>
    )
}


function Repository({repoId, repoData, onDeleteRepo, onInstallAddon, onDeleteAddon, onUpdateAddon, onSelfUpdateAddon, onEnableAddon}) {
    return (
        <div key={repoId} className="TAM-repository-div">
            <div className="TAM-repository-controls">
                <h5>{repoId}</h5>
                <Button
                    icon="bx bx-trash"
                    text="Delete Repository"
                    onClick={e => {
                        const hasInstalled = Object.values(repoData.addons ?? {}).some(a => a.installedVersion)
                        if (hasInstalled) {
                            api.showMessage("Cannot delete repository: some addons are still installed. Uninstall them first.")
                            return
                        }
                        onDeleteRepo(repoId)
                    }}
                />
            </div>
            <div>
                {Object.entries(repoData.addons ?? {}).map(([addonId, addonData]) => (
                    <Addon
                        key={addonId}
                        addonId={addonId}
                        addonData={addonData}
                        isSelf={addonId === "trilium-addon-manager@beatlink"}
                        onInstall={addonId => {onInstallAddon(repoId, addonId)}}
                        onDelete={addonId => {onDeleteAddon(repoId, addonId)}}
                        onUpdate={addonId => {onUpdateAddon(repoId, addonId)}}
                        onSelfUpdate={addonId => {onSelfUpdateAddon(repoId, addonId)}}
                        onEnable={(addonId, enabled) => {onEnableAddon(repoId, addonId, enabled)}}
                    />
                ))}
                {/* Optional placeholder if no addons */}
                {(!repoData.addons || Object.keys(repoData.addons).length === 0) && (
                    <p>No addons available.</p>
                )}
            </div>
        </div>
    )
}


function NewRepo({onSave}){
    const [repoId, setRepoId] = useState("")
    return (
        <div className="TAM-new-repository-div">
            <FormTextBox
                placeholder="owner/repo"
                currentValue={repoId}
                onChange={(newValue) => {setRepoId(newValue)}}
                className="TAM-new-repository-text"
            />    
            <Button
                icon="bx bx-plus"
                text="Add Repository"
                onClick={e => {
                    onSave(repoId)
                }}
            />
        </div>
    )
}

// Prompt Review ---------------------------------------------------------------
function PromptReview({ prompts, onResolve }) {
    const [decisions, setDecisions] = useState(
        Object.fromEntries(prompts.map(p => [p.noteLocalId, false]))
    )

    return (
        <div className="TAM-prompt-review">
            <h3>Update Review</h3>
            <p>The following files were updated. Choose which version to keep for each:</p>
            {prompts.map(prompt => (
                <div key={prompt.noteLocalId} className="TAM-prompt-item">
                    <h4>{prompt.title}</h4>
                    <div className="TAM-prompt-options">
                        <div
                            className={`TAM-prompt-option${!decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: false })}
                        >
                            <label>Keep Mine</label>
                            <pre className="TAM-prompt-content">{prompt.currentContent}</pre>
                        </div>
                        <div
                            className={`TAM-prompt-option${decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: true })}
                        >
                            <label>Use New Default</label>
                            <pre className="TAM-prompt-content">{prompt.newContent}</pre>
                        </div>
                    </div>
                </div>
            ))}
            <Button icon="bx bx-check" text="Apply" onClick={() => onResolve(decisions)} />
        </div>
    )
}


// Widget ---------------------------------------------------------------------
export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [command, setCommand] = useState(null)
    const [repositories, setRepositories] = useState(null)
    const [pendingPrompts, setPendingPrompts] = useState([])
    const [promptContext, setPromptContext] = useState(null)
    const [promptQueue, setPromptQueue] = useState([])

    // Main Command Handler
    useEffect(() => {
        if (!command) return;
        async function commandHandler(){
            const displayNote = await currentNote.getRelationValue("displayNote")
            switch (command["command"]) {
                case "load-repository": {
                    setRepositories((await libTAMjs.getAllRepositories()))
                    setCommand(null)
                    break
                }
                case "add-repository": {
                    await libTAMjs.addRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "update-repositories": {
                    await libTAMjs.updateRepositories()
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "delete-repository": {
                    await libTAMjs.deleteRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "install-addon": {
                    await libTAMjs.installAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "delete-addon": {
                    await libTAMjs.deleteAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "update-addon": {
                    await libTAMjs.updateAddon(command["repository"], command["addon"])
                    const prompts = await libTAMjs.getPendingPrompts(command["repository"], command["addon"])
                    if (prompts.length > 0) {
                        setPendingPrompts(prompts)
                        setPromptContext({ repoId: command["repository"], addonId: command["addon"] })
                        setCommand(null)
                    } else {
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "resolve-prompts": {
                    const { repoId, addonId, decisions } = command
                    for (const [noteLocalId, useNew] of Object.entries(decisions)) {
                        await libTAMjs.resolvePrompt(repoId, addonId, noteLocalId, useNew)
                    }
                    await libTAMjs.clearPendingPrompts(repoId, addonId)

                    if (promptQueue.length > 0) {
                        const [next, ...rest] = promptQueue
                        const prompts = await libTAMjs.getPendingPrompts(next.repoId, next.addonId)
                        setPendingPrompts(prompts)
                        setPromptContext(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        setPendingPrompts([])
                        setPromptContext(null)
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "update-all": {
                    const targets = []
                    for (const [repoId, repoData] of Object.entries(repositories)) {
                        for (const [addonId, addonData] of Object.entries(repoData.addons ?? {})) {
                            if (addonData.installedVersion && addonData.updateAvailable) {
                                targets.push({ repoId, addonId })
                            }
                        }
                    }

                    const queue = []
                    for (const { repoId, addonId } of targets) {
                        if (addonId === "trilium-addon-manager@beatlink") {
                            await libTAMjs.selfUpdateAddon(repoId, addonId)
                        } else {
                            await libTAMjs.updateAddon(repoId, addonId)
                            const prompts = await libTAMjs.getPendingPrompts(repoId, addonId)
                            if (prompts.length > 0) queue.push({ repoId, addonId })
                        }
                    }

                    if (queue.length > 0) {
                        const [next, ...rest] = queue
                        const prompts = await libTAMjs.getPendingPrompts(next.repoId, next.addonId)
                        setPendingPrompts(prompts)
                        setPromptContext(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "self-update-addon": {
                    await libTAMjs.selfUpdateAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "enable-addon": {
                    await libTAMjs.enableAddon(command["repository"], command["addon"], command["enabled"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
            }
        }
        commandHandler()
    }, [command])

    // Trigger Loading of Repository on Page load
    useEffect(() => {
        if (!note) return;
        setCommand({command: "load-repository"})
    }, [note])

    if (!repositories) {
        return <div>Loading repositories...</div>;
    }

    if (pendingPrompts.length > 0 && promptContext) {
        return (
            <div className="TAM-body">
                <div className="TAM-header">
                    <h2>Trilium Addon Manager</h2>
                    <a href="https://beatlink.github.io/trilium-scripts/" target="_blank" className="TAM-catalog-link">Browse Addon Catalog ↗</a>
                </div>
                {promptQueue.length > 0 && (
                    <p>{promptContext.addonId} — {promptQueue.length} more addon(s) to review after this</p>
                )}
                <PromptReview
                    prompts={pendingPrompts}
                    onResolve={(decisions) => setCommand({
                        command: "resolve-prompts",
                        repoId: promptContext.repoId,
                        addonId: promptContext.addonId,
                        decisions
                    })}
                />
            </div>
        )
    }

    const anyUpdateAvailable = Object.values(repositories).some(repoData =>
        Object.values(repoData.addons ?? {}).some(a => a.installedVersion && a.updateAvailable)
    )

    return (
        <div className="TAM-body">
            <div className="TAM-header">
                <h2>Trilium Addon Manager</h2>
                <a href="https://beatlink.github.io/trilium-scripts/" target="_blank" className="TAM-catalog-link">Browse Addon Catalog ↗</a>
            </div>
            <div>
                <h4>Repository Management</h4>
                <div className="TAM-repository-main-controls">
                    <Button
                        icon="bx bx-sync"
                        text="Update Repositories"
                        onClick={e => {
                            setCommand({ command: "update-repositories" })
                        }}
                    />
                    {anyUpdateAvailable && <Button
                        icon="bx bx-sync"
                        text="Update All Addons"
                        onClick={e => {
                            setCommand({ command: "update-all" })
                        }}
                    />}
                    <NewRepo
                        onSave={value => {
                            setCommand({ command: "add-repository", repository: value })
                        }}
                    />
                </div>
            </div>
            <div>
                <h4>Repositories</h4>
                {Object.entries(repositories).map(([repoId, repoData]) => (
                    <Repository
                        repoId={repoId}
                        repoData={repoData}
                        onDeleteRepo={repoId => {
                            setCommand({
                                command: "delete-repository",
                                repository: repoId
                            })
                        }}
                        onInstallAddon={(repoId, addonId) => {
                            setCommand({
                                command: "install-addon",
                                repository: repoId,
                                addon: addonId
                            })
                        }}
                        onDeleteAddon={(repoId, addonId) => {
                            setCommand({
                                command: "delete-addon",
                                repository: repoId,
                                addon: addonId
                            })
                        }}
                        onUpdateAddon={(repoId, addonId) => {
                            setCommand({
                                command: "update-addon",
                                repository: repoId,
                                addon: addonId
                            })
                        }}
                        onSelfUpdateAddon={(repoId, addonId) => {
                            setCommand({
                                command: "self-update-addon",
                                repository: repoId,
                                addon: addonId
                            })
                        }}
                        onEnableAddon={(repoId, addonId, enabled) => {
                            setCommand({
                                command: "enable-addon",
                                repository: repoId,
                                addon: addonId,
                                enabled: enabled
                            })
                        }}
                    />
                ))}
            </div>
        </div>
    )
}
