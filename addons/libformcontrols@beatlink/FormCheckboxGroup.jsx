import { FormCheckbox } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"

export function FormCheckboxGroup({id, label, expanded, onToggle, items}) {
    return (
        <Collapsible
            label={label}
            expanded={expanded}
            onToggle={onToggle}
            className="checkboxGroup"
        >
            <ul>{
                items.map(item =>
                    (<FormCheckbox
                        key={item.key}
                        label={item.label}
                        currentValue={item.currentValue}
                        onChange={item.onChange}
                    />)
                )
            }</ul>
        </Collapsible>
    )
}
