# Action Picker

Reusable Preact component rendering **Complete Task**, **Start Today**, and **Start Tomorrow**
buttons for a task-like note, on top of [`libagendatask@beatlink`](../libagendatask@beatlink/)'s
`complete`/`rescheduleByDays`.

## Usage

Install as a dependency and clone the `ActionPicker.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { ActionPicker } from "ActionPicker.jsx"

<ActionPicker
    constants={{
        START_DATETIME_LABEL: "startDate",
        RECURRENCE_LABEL: "recurrence"
    }}
    onAfterChange={() => { /* refresh whatever depends on this note's task labels */ }}
/>
```

The component reads the currently active note (`useActiveNoteContext()`) directly — it doesn't take
the note as a prop.

## Props

| Prop            | Type     | Description                                                        |
|-----------------|----------|----------------------------------------------------------------------|
| `constants`     | object   | Label names `complete`/`rescheduleByDays` need — see [`libagendatask@beatlink`](../libagendatask@beatlink/) |
| `onAfterChange` | function | Called after Complete/Start Today/Start Tomorrow, so a consumer can refresh anything derived from these labels |

## See it in use

[`agenda@beatlink`](../agenda@beatlink/)'s manifest shows the dependency wiring a consumer needs.
