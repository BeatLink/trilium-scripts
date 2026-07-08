import { Button } from "trilium:preact"
import { ElementSelect } from "elementPicker.jsx"

export function PrefixesEditor({ prefixes, registry, onChange, onOpenLibrary }) {
    return (
        <div className="pe-field-row">
            <label>Prefix</label>
            <ElementSelect
                category="prefixes"
                registry={registry}
                value={prefixes.selected}
                onChange={selected => onChange({ ...prefixes, selected })}
            />
            {onOpenLibrary && (
                <Button icon="bx-library" text="Manage Elements" onClick={onOpenLibrary} />
            )}
        </div>
    )
}
