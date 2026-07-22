import { useState, useRef, useEffect } from "trilium:preact"

const PALETTE = [
    "red", "orange", "darkorange", "gold", "yellow",
    "lime", "green", "teal", "cyan", "blue",
    "indigo", "purple", "magenta", "pink", "brown", "gray"
]

// A swatch-button trigger that opens a popover grid for a curated CSS color
// palette, plus a "custom" swatch that reveals a free-text CSS-color input —
// covers both the common case (pick from the palette) and anything outside
// it (an arbitrary hex/named color) without forcing every consumer to
// define its own palette. Collapsed by default so it reads as a single
// compact control (fits a table cell) rather than always showing the full
// grid inline.
export function ColorPicker({ currentValue, onChange }) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef(null)
    const isCustomValue = !!currentValue && !PALETTE.includes(currentValue)

    useEffect(() => {
        if (!open) return
        function handleClickOutside(e) {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [open])

    function pick(color) {
        onChange(color)
        if (color !== "") setOpen(false)
    }

    return (
        <div className="colorpicker" ref={rootRef}>
            <button type="button" className="colorpicker-trigger" onClick={() => setOpen(o => !o)}>
                <span
                    className="colorpicker-trigger-swatch"
                    style={{ backgroundColor: currentValue || "transparent" }}
                />
                <span className="colorpicker-trigger-label">{currentValue || "Choose color"}</span>
            </button>
            {open && (
                <div className="colorpicker-popover">
                    <div className="colorpicker-grid">
                        {PALETTE.map(color => (
                            <button
                                key={color}
                                type="button"
                                title={color}
                                className={`colorpicker-swatch${currentValue === color ? " colorpicker-swatch-active" : ""}`}
                                style={{ backgroundColor: color }}
                                onClick={() => pick(color)}
                            />
                        ))}
                        <button
                            type="button"
                            title="Custom color"
                            className={`colorpicker-swatch colorpicker-swatch-custom${isCustomValue ? " colorpicker-swatch-active" : ""}`}
                            style={isCustomValue ? { backgroundColor: currentValue } : undefined}
                            onClick={() => pick("")}
                        />
                    </div>
                    {(isCustomValue || currentValue === "") && (
                        <input
                            type="text"
                            className="form-control"
                            placeholder="CSS color (e.g. #ff8800, teal)"
                            value={currentValue || ""}
                            onInput={e => onChange(e.target.value)}
                            autoFocus
                        />
                    )}
                </div>
            )}
        </div>
    )
}
