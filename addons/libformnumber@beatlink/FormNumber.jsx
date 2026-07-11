export function FormNumber({ value, min, step, placeholder, onChange }) {
    return (
        <div>
            <input
                type="number"
                value={value}
                min={min}
                step={step}
                placeholder={placeholder ? placeholder : ""}
                onInput={(e) => {
                    const raw = e.target.value
                    onChange(raw === "" ? "" : Number(raw));
                    e.preventDefault()
                }}
                className='form-control'
            />
        </div>
    )
}
