import { Button } from "trilium:preact"
import { ElementSelect } from "elementPicker.jsx"

export function ColorsEditor({ colors, registry, onChange, onOpenLibrary }) {
    return (
        <div className="pe-field-row">
            <label>Color</label>
            <ElementSelect
                category="colors"
                registry={registry}
                value={colors.selected}
                onChange={selected => onChange({ ...colors, selected })}
            />
            {onOpenLibrary && (
                <Button icon="bx-library" text="Manage Elements" onClick={onOpenLibrary} />
            )}
        </div>
    )
}
