// Imports --------------------------------------------------------------------
import {
    defineWidget,
    useActiveNoteContext,
    FormTextBox,
    Button,
    useState,
    useEffect
} from "trilium:preact"


function Addon({addonId, addonData, onInstall, onDelete, onUpdate, onEnable}){
    console.log(addonId)
    return (
        <div key={addonId}>
            <div className="TAM-addon-div">
                <label>Name: {addonData.name}</label>
                <label>Description: {addonData.description}</label>
                <label>Author: {addonData.author}</label>
                <label>Homepage: {addonData.homepage}</label>
                <label>License: {addonData.license}</label>
                <label>Latest Version: {addonData.latestVersion}</label>
                <label>Installed Version: {addonData.installedVersion ?? ""}</label>
                <label>Type {addonData.type}</label>
                <label>ID: {addonId}</label>
            </div>
            <div>
                {!addonData.installedVersion && <Button
                    icon="bx bx-download"
                    text="Install Addon"
                    onClick={e => {
                        onInstall(addonId)
                    }}
                />}
                {addonData.installedVersion && <Button
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
                {addonData.updateAvailable == true && <Button
                    icon="bx bx-sync"
                    text="Update Addon"
                    onClick={e => {
                        onUpdate(addonId)
                    }}
                />}
            </div>
        </div>
    )
}


function Repository({repoId, repoData, onDeleteRepo, onInstallAddon, onDeleteAddon, onUpdateAddon, onEnableAddon}) {
    return (
        <div key={repoId} className="TAM-repository-div">
            <div className="TAM-repository-controls">
                <h6>{repoId}</h6>
                <Button
                    icon="bx bx-trash"
                    text="Delete Repository"
                    onClick={e => {
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
                        onInstall={addonId => {onInstallAddon(repoId, addonId)}}
                        onDelete={addonId => {onDeleteAddon(repoId, addonId)}}
                        onUpdate={addonId => {onUpdateAddon(repoId, addonId)}}
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

// Widget ---------------------------------------------------------------------
export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [command, setCommand] = useState(null)
    const [repositories, setRepositories] = useState(null)

    // Main Command Handler
    useEffect(() => {
        if (!command) return;
        async function commandHandler(){
            switch (command["command"]) {
                case "load-repository": {
                    setRepositories((await libTAMjs.getAllRepositories()))
                    setCommand(null)
                    break
                }
                case "add-repository": {
                    await libTAMjs.addRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    break
                }
                case "update-repositories": {
                    await libTAMjs.updateRepositories()
                    setCommand({command: "load-repository"})
                    break
                }
                case "delete-repository": {
                    await libTAMjs.deleteRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    break
                }
                case "install-addon": {
                    await libTAMjs.installAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    break
                }
                case "delete-addon": {
                    await libTAMjs.deleteAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    break
                }
                case "update-addon": {
                    await libTAMjs.updateAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    break
                }
                case "enable-addon": {
                    await libTAMjs.enableAddon(command["repository"], command["addon"], command["enabled"])
                    setCommand({command: "load-repository"})
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

    return (
        <div className="TAM-body">
            <h2>Trilium Addon Manager</h2>
            <div>
                <h5>Repository Management</h5>
                <div className="TAM-repository-main-controls">
                    <Button
                        icon="bx bx-sync"
                        text="Update Repositories"
                        onClick={e => {
                            setCommand({ command: "update-repositories" })
                        }}
                    />
                    <NewRepo
                        onSave={value => {
                            setCommand({ command: "add-repository", repository: value })
                        }}
                    />
                </div>
            </div>
            <div>
                <h5>Repositories</h5>
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
