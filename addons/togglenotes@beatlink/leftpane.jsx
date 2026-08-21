import { defineLauncherWidget, useActiveNoteContext } from "trilium:preact"

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

const { LauncherButtons } = await tamRequire("togglenotes@beatlink/launcherbuttons-jsx")

export default defineLauncherWidget({
    render: () => {
        return <LauncherButtons variant="launchbar" />
    }
})