// The My Day note, edited in place in the right panel.
//
// Trilium bundles CKEditor and does not expose it to script notes, so there is no
// import that reaches the editor class. Instead the class and its fully built
// configuration are borrowed from whichever text editor the app has already
// created - the note detail's own editor - and reused to build a second instance
// inside the panel. Until a text note has been opened at least once there is
// nothing to borrow, so the panel falls back to showing the note's content
// read-only.

import {
    useEffect,
    useRef,
    useState,
    useNote,
    useNoteBlob,
    useSpacedUpdate,
    useTriliumEvent,
} from "trilium:preact"

// The borrowed editor class and config, captured once per page load.
let captured = null

// Root and data entries name the editor they were built for. `roots.main.element`
// in particular still points at the note detail's own element, and CKEditor throws
// editor-create-root-element-overspecified when a config carrying it is used to
// create an editor on a different element.
const NOT_TRANSFERABLE = ["roots", "root", "rootsAttributes", "initialData"]

function captureEditor(editor) {
    if (captured || !editor?.config?.names) return
    const config = {}
    for (const name of editor.config.names()) config[name] = editor.config.get(name)
    for (const name of NOT_TRANSFERABLE) delete config[name]
    captured = { EditorClass: editor.constructor, config }
}

export function MyDayNote({ noteId }) {
    const note = useNote(noteId)
    const blob = useNoteBlob(note)
    const containerRef = useRef(null)
    const editorRef = useRef(null)
    // What the editor holds, and what was last written to the note.
    const contentRef = useRef("")
    const savedRef = useRef(null)
    const [hasEditor, setHasEditor] = useState(Boolean(captured))
    const [failed, setFailed] = useState(false)

    const spacedUpdate = useSpacedUpdate(async () => {
        const content = contentRef.current
        if (!noteId || content === savedRef.current) return
        savedRef.current = content
        await api.runOnBackend((noteId, content) => {
            const note = api.getNote(noteId)
            if (!note) return
            note.setContent(content)
            note.save()
        }, [noteId, content])
    }, 1000)

    // Every text editor the app builds is a chance to capture the class.
    useTriliumEvent("textEditorRefreshed", ({ editor }) => {
        captureEditor(editor)
        if (captured) setHasEditor(true)
    })

    useEffect(() => {
        if (captured) return
        ;(async () => {
            // Throws when the active note is not a text note, which is simply the
            // case where there is nothing to capture yet.
            try {
                captureEditor(await api.getActiveContextTextEditor())
            } catch (e) {
                return
            }
            if (captured) setHasEditor(true)
        })()
    }, [])

    useEffect(() => {
        if (!hasEditor || failed || !containerRef.current || editorRef.current) return
        const container = containerRef.current
        let destroyed = false
        captured.EditorClass.create(container, captured.config).then(editor => {
            if (destroyed) {
                editor.destroy()
                return
            }
            editorRef.current = editor

            // The fixed-toolbar editor type is decoupled: it builds a toolbar but
            // leaves placing it to the caller, so it has to be put above the
            // editable here. The floating-toolbar type has none to place.
            const toolbar = editor.ui?.view?.toolbar?.element
            if (toolbar && !toolbar.isConnected) container.before(toolbar)

            editor.setData(contentRef.current || "")
            editor.model.document.on("change:data", () => {
                contentRef.current = editor.getData()
                spacedUpdate.scheduleUpdate()
            })
        }).catch(e => {
            console.error("My Day: could not build the panel editor", e)
            setFailed(true)
        })
        return () => {
            destroyed = true
            spacedUpdate.updateNowIfNecessary()
            editorRef.current?.destroy()
            editorRef.current = null
        }
    }, [hasEditor, failed])

    // Content the panel did not write - a task filed by the suggestion list, a
    // prune, or an edit in the note detail - is pulled in, but never while the
    // user is typing here, which would move their cursor.
    useEffect(() => {
        if (!blob) return
        const content = blob.content ?? ""
        if (content === contentRef.current) return
        if (editorRef.current?.ui.focusTracker.isFocused) return
        contentRef.current = content
        savedRef.current = content
        editorRef.current?.setData(content)
    }, [blob])

    if (!hasEditor || failed) {
        return (
            <div
                className="myDayNote myDayNoteReadOnly ck-content"
                dangerouslySetInnerHTML={{ __html: blob?.content ?? "" }}
            />
        )
    }

    // CKEditor hides the element it is created on and inserts its own UI after it,
    // so the styled wrapper has to be the parent rather than that element itself.
    return (
        <div className="myDayNote">
            <div ref={containerRef} />
        </div>
    )
}
