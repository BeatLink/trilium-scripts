import { Button } from "trilium:preact"
import { ElementSelect } from "elementPicker.jsx"

export function SortsEditor({ sorts, registry, onChange, onOpenLibrary }) {
    return (
        <div className="pe-field-row">
            <label>Sort</label>
            <ElementSelect
                category="sorts"
                registry={registry}
                value={sorts.selected}
                onChange={selected => onChange({ ...sorts, selected })}
            />
            {onOpenLibrary && (
                <Button icon="bx-library" text="Manage Elements" onClick={onOpenLibrary} />
            )}
        </div>
    )
}
