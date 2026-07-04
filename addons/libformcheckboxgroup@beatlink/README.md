# Form Checkbox Group

Reusable Preact component rendering a labeled, collapsible group of checkboxes for TriliumNext
widget UIs. Depends on [libcollapsible@beatlink](../libcollapsible@beatlink/) for the collapsible
wrapper.

## Usage

Install as a dependency and clone the `FormCheckboxGroup.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { FormCheckboxGroup } from "FormCheckboxGroup.jsx"

<FormCheckboxGroup
    label="Note Type"
    expanded={group.expanded}
    onToggle={e => setExpanded(e.currentTarget.open)}
    items={[
        { key: "calendar", label: "High Priority", currentValue: true, onChange: v => {} }
    ]}
/>
```

## Props

| Prop       | Type     | Description                                                        |
|------------|----------|------------------------------------------------------------------------|
| `label`    | string   | Text shown in the collapsible header                                  |
| `expanded` | boolean  | Whether the group is open                                              |
| `onToggle` | function | Called with the native toggle event                                    |
| `items`    | array    | `{ key, label, currentValue, onChange }` entries, one per checkbox     |
