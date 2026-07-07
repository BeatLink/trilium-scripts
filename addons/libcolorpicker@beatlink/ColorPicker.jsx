const PALETTE = [
    "red", "orange", "darkorange", "gold", "yellow",
    "lime", "green", "teal", "cyan", "blue",
    "indigo", "purple", "magenta", "pink", "brown", "gray"
]

const swatchBase = {
    display: "inline-block",
    width: "1.5rem",
    height: "1.5rem",
    borderRadius: "50%",
    marginRight: "0.35rem",
    marginBottom: "0.35rem",
    cursor: "pointer",
    padding: 0
}

// A swatch grid for a curated CSS color palette, plus a "custom" swatch that
// reveals a free-text CSS-color input — covers both the common case (pick
// from the palette) and anything outside it (an arbitrary hex/named color)
// without forcing every consumer to define its own palette.
export function ColorPicker({ currentValue, onChange }) {
    const isCustomValue = !!currentValue && !PALETTE.includes(currentValue)
    const showCustomInput = isCustomValue || currentValue === ""

    return (
        <div className="colorpicker">
            <div>
                {PALETTE.map(color => (
                    <button
                        key={color}
                        type="button"
                        title={color}
                        style={{
                            ...swatchBase,
                            backgroundColor: color,
                            border: currentValue === color
                                ? "2px solid var(--main-text-color)"
                                : "2px solid transparent"
                        }}
                        onClick={() => onChange(color)}
                    />
                ))}
                <button
                    type="button"
                    title="Custom color"
                    style={{
                        ...swatchBase,
                        backgroundColor: isCustomValue ? currentValue : "transparent",
                        border: isCustomValue
                            ? "2px solid var(--main-text-color)"
                            : "2px dashed var(--muted-text-color)"
                    }}
                    onClick={() => onChange("")}
                />
            </div>
            {showCustomInput && (
                <input
                    type="text"
                    className="form-control"
                    placeholder="CSS color (e.g. #ff8800, teal)"
                    value={currentValue || ""}
                    onInput={e => onChange(e.target.value)}
                />
            )}
        </div>
    )
}
