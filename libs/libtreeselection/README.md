# Tree Selection

The note tree's current multi-selection, as a Preact hook. Right-pane widgets that act on a whole
selection rather than on the active note alone (`area-picker@beatlink`, `template-picker@beatlink`,
`agenda-task@beatlink`) all need the same read, so it lives here once.

The tree emits no event when its selection changes and the script API exposes no selection
accessor, so the hook reads the selection off the tree widget and watches the fancytree DOM for the
class flips an alt-click produces. On mobile, which has no tree widget, it returns `[]`.

## Usage

Add `treeSelection.jsx` as a note wherever it's `import`ed from — Trilium's require resolver only
finds a module note that is a **direct child** of the requiring note, so wire it as a child of every
note that imports from it (not just once via an ancestor).

```jsx
import { useSelectedNoteIds } from "treeSelection.jsx"

const selectedNoteIds = useSelectedNoteIds()
// A selection retargets the widget at every selected note; with nothing
// selected the widget stays on the active note.
const targets = selectedNoteIds.length ? selectedNoteIds : [noteId]
```

### `useSelectedNoteIds()`

The selected noteIds in tree order, re-read whenever the selection changes. The array identity is
kept stable across tree repaints that don't change the selection, so it is safe as a `useEffect`
dependency.
