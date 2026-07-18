# Form Controls

Reusable Preact form-control components for TriliumNext widget UIs.

Anything `trilium:preact` already provides is not duplicated here. Use Trilium's own components for
plain inputs (`FormTextBox` with the appropriate `type`, e.g. `<FormTextBox type="datetime-local" />`),
pill toggle buttons (`FormToggleButton`), sliding switches (`FormToggle`), checkboxes
(`FormCheckbox`), and collapsible sections (`Collapsible`). Note that `FormTextBox` with
`type="number"` clamps the value to `min`/`max` on every keystroke.

| Export         | Note                    | Component          | Description                                                        |
|----------------|-------------------------|--------------------|--------------------------------------------------------------------|
| `colorpicker`  | `ColorPicker.jsx`       | `ColorPicker`      | curated color-swatch grid with a custom CSS-color fallback         |

## Usage

Add `libformcontrols@beatlink` as a dependency and clone the export as a child of the JSX widget that
uses it, then import by note title:

```jsx
import { ColorPicker } from "ColorPicker.jsx"
```

Wire it in your manifest:

```json
{ "parent": "my-widget", "addon": "libformcontrols@beatlink", "child": "colorpicker" }
```

The `colorpicker` export ships its own `ColorPicker.css` (`#appCss`).
