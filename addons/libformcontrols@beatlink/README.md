# Form Controls

Reusable Preact form-control components for TriliumNext widget UIs. Each control is exported
separately, so a consumer clones only the ones it uses.

| Export         | Note                    | Component          | Description                                                        |
|----------------|-------------------------|--------------------|--------------------------------------------------------------------|
| `datetime`     | `FormDatetime.jsx`      | `FormDatetime`     | datetime-local input                                               |
| `number`       | `FormNumber.jsx`        | `FormNumber`       | number input                                                       |
| `togglebutton` | `FormToggleButton.jsx`  | `FormToggleButton` | toggle button (a checkbox styled as a pill button)                 |
| `checkboxgroup`| `FormCheckboxGroup.jsx` | `FormCheckboxGroup`| labeled, collapsible group of checkboxes (uses `collapsible`)      |
| `colorpicker`  | `ColorPicker.jsx`       | `ColorPicker`      | curated color-swatch grid with a custom CSS-color fallback         |
| `collapsible`  | `Collapsible.jsx`       | `Collapsible`      | collapsible section (a styled native `<details>`/`<summary>`)      |

## Usage

Add `libformcontrols@beatlink` as a dependency and clone the export you need as a child of the JSX
widget that uses it, then import by note title:

```jsx
import { FormNumber } from "FormNumber.jsx"
import { ColorPicker } from "ColorPicker.jsx"
```

Wire each export in your manifest, e.g.:

```json
{ "parent": "my-widget", "addon": "libformcontrols@beatlink", "child": "number" }
```

The `colorpicker` export ships its own `ColorPicker.css` (`#appCss`); `checkboxgroup` pulls in the
`collapsible` control automatically.
