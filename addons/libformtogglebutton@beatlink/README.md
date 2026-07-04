# Form Toggle Button

Reusable Preact component rendering a checkbox as a pill-style toggle button, for boolean settings
inside TriliumNext widget UIs.

## Usage

Install as a dependency and clone the `FormToggleButton.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { FormToggleButton } from "FormToggleButton.jsx"

<FormToggleButton
    label="Task Repeats"
    currentValue={enabled}
    onChange={value => setEnabled(value)}
/>
```

## Props

| Prop           | Type     | Description                        |
|----------------|----------|-------------------------------------|
| `label`        | string   | Button text                        |
| `currentValue` | boolean  | Current toggle state                |
| `onChange`     | function | Called with the new boolean value  |
