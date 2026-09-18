import { useEffect, useState } from "trilium:preact"

// The note tree emits no event when its multi-selection changes and the script
// API exposes no selection accessor, so read the selection off the tree widget
// and watch the fancytree DOM for the class flips an alt-click produces.
// Returns [] on mobile, which has no tree widget.
export function useSelectedNoteIds() {
    const [selected, setSelected] = useState([])
    useEffect(() => {
        const tree = window.glob?.appContext?.noteTreeWidget
        const container = tree?.$tree?.[0]
        if (!container) return
        const read = () => {
            const ids = tree.getSelectedNodes(true).map(node => node.data.noteId)
            // Every tree repaint rewrites these classes, so bail out on an
            // unchanged selection rather than re-running the widget's effect.
            setSelected(prev =>
                prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids)
        }
        read()
        const observer = new MutationObserver(read)
        observer.observe(container, { attributes: true, attributeFilter: ["class"], subtree: true })
        return () => observer.disconnect()
    }, [])
    return selected
}
