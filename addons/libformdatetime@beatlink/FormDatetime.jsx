export function FormDatetime({label, value, onChange}){
    return (
        <div>
            <input
                type="datetime-local"
                placeholder="not set"
                className="form-control"
                onChange={event => {
                    onChange(event.target.value)
                    event.preventDefault()
                }}
                value={value}
            />
        </div>
    )
}
