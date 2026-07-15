export function FormTime({ value, onChange }) {
    return (
        <div>
            <input
                type="time"
                placeholder="not set"
                className="form-control"
                value={value}
                onChange={event => {
                    onChange(event.target.value)
                    event.preventDefault()
                }}
            />
        </div>
    )
}
