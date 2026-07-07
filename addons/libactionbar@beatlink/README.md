# Action Bar

Reusable Preact component rendering a row of action buttons for TriliumNext widget UIs. Fully
generic — it has no idea what "an action" means for any given consumer (completing a task, hoisting
a note, toggling zen mode, ...); each entry supplies its own icon, text, and `onClick`.

## Usage

Install as a dependency and clone the `ActionBar.jsx` note as a child of the JSX widget that needs
it:

```jsx
import { ActionBar } from "ActionBar.jsx"

<ActionBar
    actions={[
        { key: "complete", icon: "bx bx-check", text: "Complete Task", onClick: async () => { /* ... */ } },
        { key: "hoist", icon: "bx bx-expand", text: "Hoist Note", onClick: () => { /* ... */ } }
    ]}
/>
```

Whatever a click should refresh afterward (an overview list, a settings note, nothing at all) is the
caller's own concern — fold it into that action's own `onClick`.

## Props

| Prop      | Type  | Description                                                                 |
|-----------|-------|-------------------------------------------------------------------------------|
| `actions` | array | `{ key, icon, text, onClick }` objects, one per button, rendered in order    |

## See it in use

[`agenda@beatlink`](../agenda@beatlink/)'s manifest shows the dependency wiring a consumer needs —
its own widget code builds the `actions` array from
[`libagendatask@beatlink`](../libagendatask@beatlink/)'s `complete`/`rescheduleByDays`.
