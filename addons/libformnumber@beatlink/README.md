# Form Number

Reusable Preact number-input component for TriliumNext widget UIs.

## Usage

Install as a dependency and clone the `FormNumber.jsx` note as a child of the JSX widget that needs
it:

```jsx
import { FormNumber } from "FormNumber.jsx"

<FormNumber
    value={rank}
    min="0"
    step="1"
    onChange={value => setRank(value)}
/>
```

## Props

| Prop          | Type     | Description                          |
|---------------|----------|----------------------------------------|
| `value`       | number   | Current value                          |
| `min`         | number   | Minimum allowed value (optional)       |
| `step`        | number   | Step increment (optional)              |
| `placeholder` | string   | Placeholder text (optional)            |
| `onChange`    | function | Called with the new value (as a string)|
