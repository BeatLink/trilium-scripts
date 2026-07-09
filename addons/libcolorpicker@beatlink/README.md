# Color Picker

Reusable Preact component rendering a curated color-swatch grid, plus a custom-color fallback, for
TriliumNext widget UIs.

## Usage

Install as a dependency and clone the `ColorPicker.jsx` note as a child of the JSX widget that needs
it:

```jsx
import { ColorPicker } from "ColorPicker.jsx"

<ColorPicker
    currentValue={color}
    onChange={value => setColor(value)}
/>
```

Renders as a single compact swatch button; clicking it opens a popover with the palette grid.
Clicking a swatch calls `onChange` with that CSS color name and closes the popover. Clicking the
dashed "custom" swatch (or passing an empty string as `currentValue`) reveals a free-text input for
any CSS color the palette doesn't cover (a hex code, or any other valid CSS color keyword) and keeps
the popover open for typing.

## Props

| Prop           | Type     | Description                                          |
|----------------|----------|-------------------------------------------------------|
| `currentValue` | string   | Current CSS color value (palette name, hex, or `""`)  |
| `onChange`     | function | Called with the new CSS color string                 |

## See it in use

[`libsettings@beatlink`](../libsettings@beatlink/) depends on this library to render its `"color"`
schema field type.
