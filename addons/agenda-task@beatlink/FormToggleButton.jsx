import { useId } from "trilium:preact";

export function FormToggleButton({ label, currentValue, onChange }) {
    const buttonId = useId()
    return (
        <div className="togglebutton">
            <input
                type="checkbox"
                className="btn-check"
                id={buttonId}
                autocomplete="off"
                checked={currentValue}
                onChange={e => {
                    e.preventDefault()
                    onChange(!currentValue)
                }}
            />
            <label className="btn btn-primary" for={buttonId}>
                {label}
            </label>
        </div>
    )
}
