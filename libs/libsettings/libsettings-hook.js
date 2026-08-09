// TAM lifecycle hook entry point for any addon whose settings this library owns.
// A consumer points every `manifest.hooks` phase it wants at this note and gives
// it `schemaNote`/`configNote` relations; all the behaviour lives in
// `runSettingsHook` (libsettings-ui.jsx), next to the merge helpers it needs.
//
// Plain `env=frontend` rather than jsx on purpose: TAM reads a hook's *return
// value*, and only a classic script's top-level `return` comes back out of the
// bundle — a jsx note's `export default` would hand back the function itself.
const { runSettingsHook } = require("libSettingsUI.jsx")

// Read the context label from the backend rather than off `api.startNote`: TAM
// writes it immediately before calling executeScript(), and froca has no
// guarantee of having caught that change up by the time this runs.
const context = await api.runOnBackend(
    (noteId, label) => api.getNote(noteId).getLabelValue(label),
    [api.startNote.noteId, "tamHookContext"]
)

return await runSettingsHook(api.startNote, JSON.parse(context || "{}"))
