# Collapsible

Reusable Preact collapsible-section component (a styled native `<details>`/`<summary>`) for
TriliumNext widget UIs.

## Usage

Install as a dependency and clone the `Collapsible.jsx` note as a child of the JSX widget that needs
it:

```jsx
import { Collapsible } from "Collapsible.jsx"

<Collapsible
    label="Searches"
    expanded={section.expanded}
    onToggle={e => setExpanded(e.currentTarget.open)}
>
    {children}
</Collapsible>
```

## Props

| Prop        | Type     | Description                                  |
|-------------|----------|-------------------------------------------------|
| `label`     | string   | Text shown in the `<summary>`                   |
| `expanded`  | boolean  | Whether the section is open                     |
| `onToggle`  | function | Called with the native toggle event             |
| `className` | string   | Optional class applied to the `<details>`       |
| `children`  | node     | Content rendered inside the collapsible body    |
