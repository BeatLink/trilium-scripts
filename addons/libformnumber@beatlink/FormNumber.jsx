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
                    onChange(e.target.value);
                    e.preventDefault()
                }}
                className='form-control'
            />
        </div>
    )
}
