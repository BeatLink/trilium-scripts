# Form Datetime

Reusable Preact datetime-local input component for TriliumNext widget UIs.

## Usage

Install as a dependency and clone the `FormDatetime.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { FormDatetime } from "FormDatetime.jsx"

<FormDatetime
    value={startDatetime}
    onChange={value => setStartDatetime(value)}
/>
```

## Props

| Prop       | Type     | Description                                    |
|------------|----------|--------------------------------------------------|
| `value`    | string   | Current value, `"YYYY-MM-DDTHH:mm"` format        |
| `onChange` | function | Called with the new value (same format)           |
