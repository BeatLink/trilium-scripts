# Dates Duration Picker

Reusable Preact component rendering a start date, due date, and duration editor for TriliumNext
widget UIs. Due date is auto-derived whenever both start date and duration are set, via
[`libagendatask@beatlink`](../libagendatask@beatlink/)'s `updateDependentAttributes`.

## Usage

Install as a dependency and clone the `DatesDurationPicker.jsx` note as a child of the JSX widget
that needs it:

```jsx
import { DatesDurationPicker } from "DatesDurationPicker.jsx"

<DatesDurationPicker
    constants={{
        START_DATETIME_LABEL: "startDate",
        DUE_DATETIME_LABEL: "dueDate",
        DURATION_LABEL: "duration",
        START_DATE_LABEL: "startDateOnly",
        START_TIME_LABEL: "startTimeOnly",
        DUE_DATE_LABEL: "dueDateOnly",
        DUE_TIME_LABEL: "dueTimeOnly"
    }}
    onAfterChange={() => { /* refresh whatever depends on these labels */ }}
/>
```

The component reads/writes labels on the currently active note (`useActiveNoteContext()`) directly —
it doesn't take the note as a prop.

## Props

| Prop            | Type     | Description                                                        |
|-----------------|----------|----------------------------------------------------------------------|
| `constants`     | object   | Label names — see [`libagendatask@beatlink`](../libagendatask@beatlink/) for the full set `updateDependentAttributes` reads/writes |
| `onAfterChange` | function | Called after every edit (after `updateDependentAttributes` itself has already run), so a consumer can refresh anything else derived from these labels |

## See it in use

[`agenda@beatlink`](../agenda@beatlink/)'s manifest shows the dependency wiring a consumer needs.
