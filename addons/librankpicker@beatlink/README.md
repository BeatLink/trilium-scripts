# Rank Picker

Reusable Preact component rendering a numeric rank editor for a note, for TriliumNext widget UIs
that need a manual sort order (e.g. within an overview list).

## Usage

Install as a dependency and clone the `RankPicker.jsx` note as a child of the JSX widget that needs
it:

```jsx
import { RankPicker } from "RankPicker.jsx"

<RankPicker
    constants={{ RANK_LABEL: "rank" }}
    onAfterChange={() => { /* refresh whatever depends on this note's rank */ }}
/>
```

The component reads/writes the rank label on the currently active note (`useActiveNoteContext()`)
directly — it doesn't take the note as a prop.

## Props

| Prop            | Type     | Description                                                  |
|-----------------|----------|------------------------------------------------------------------|
| `constants`     | object   | Must include `RANK_LABEL` — the label name storing the rank value |
| `onAfterChange` | function | Called after every edit, so a consumer can refresh anything that sorts by this rank |

## See it in use

[`agenda@beatlink`](../agenda@beatlink/)'s manifest shows the dependency wiring a consumer needs.
