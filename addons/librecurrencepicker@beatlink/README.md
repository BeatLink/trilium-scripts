# Recurrence Picker

Reusable Preact component rendering a full RRULE recurrence-editing form for TriliumNext widget
UIs — interval, weekdays, day-of-month, and stop condition, on top of
[`librecurrence@beatlink`](../librecurrence@beatlink/)'s RRULE conversion.

## Usage

Install as a dependency and clone the `RecurrencePicker.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { RecurrencePicker } from "RecurrencePicker.jsx"

<RecurrencePicker
    constants={{ RECURRENCE_LABEL: "recurrence" }}
    onAfterChange={() => { /* refresh whatever depends on this note's recurrence */ }}
/>
```

The component reads/writes the recurrence label on the currently active note
(`useActiveNoteContext()`) directly — it doesn't take the note as a prop.

Ships its own responsive styling (`RecurrencePicker.css`, installed as a global `appCss` note) —
consumers don't need to style `.recurrence-picker`/`.interval-picker`/`.weekdays-picker`/
`.month-picker`/`.stop-picker` themselves.

## Props

| Prop            | Type     | Description                                                        |
|-----------------|----------|----------------------------------------------------------------------|
| `constants`     | object   | Must include `RECURRENCE_LABEL` — the label name storing the RRULE string |
| `onAfterChange` | function | Called after every edit, so a consumer can refresh anything derived from the recurrence (e.g. an overview list) |

## See it in use

[`agenda@beatlink`](../agenda@beatlink/) and [`recurrence@beatlink`](../recurrence@beatlink/) both
consume this library — their manifests show the dependency wiring a consumer needs.
