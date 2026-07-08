import { FormDropdownList } from "trilium:preact"

// Keep this list in exact lockstep with `dateVars` in
// libagendaoverview@beatlink/libAgendaOverview.js's matchesDayJsCriteria —
// these are the only moment names that DSL actually understands.
export const NAMED_MOMENTS = [
    "now", "startOfToday", "endOfToday", "endOfTomorrow",
    "endOfThisWeek", "endOfThisMonth", "endOfThisYear"
]

// Only these 4 operators appear anywhere in real profile data, even though
// matchesDayJsCriteria will actually call any dayjs method name given to it.
const OPERATORS = ["isNull", "isBefore", "isAfter", "isBetween"]
const BRACKETS = ["[]", "[)", "(]", "()"]

const momentOptions = NAMED_MOMENTS.map(m => ({ key: m, title: m }))
const operatorOptions = OPERATORS.map(o => ({ key: o, title: o }))
const bracketOptions = BRACKETS.map(b => ({ key: b, title: b }))

function defaultForOperator(op) {
    if (op === "isNull") return ["isNull"]
    if (op === "isBetween") return ["isBetween", "startOfToday", "now", null, "[]"]
    return [op, "now"] // isBefore / isAfter
}

// The one place DayjsRule tuples get constructed anywhere in the profile
// editor — every consumer just passes `value`/`onChange` through.
export function DayjsRulePicker({ value, onChange }) {
    const [operator, ...args] = value && value.length ? value : ["isNull"]

    function setOperator(newOp) {
        if (newOp === operator) return
        onChange(defaultForOperator(newOp))
    }

    return (
        <div className="pe-dayjs-rule">
            <FormDropdownList
                values={operatorOptions}
                currentValue={operator}
                onChange={setOperator}
                keyProperty="key" titleProperty="title"
            />
            {(operator === "isBefore" || operator === "isAfter") && (
                <FormDropdownList
                    values={momentOptions}
                    currentValue={args[0]}
                    onChange={m => onChange([operator, m])}
                    keyProperty="key" titleProperty="title"
                />
            )}
            {operator === "isBetween" && (
                <>
                    <FormDropdownList
                        values={momentOptions}
                        currentValue={args[0]}
                        onChange={m => onChange([operator, m, args[1], null, args[3]])}
                        keyProperty="key" titleProperty="title"
                    />
                    <FormDropdownList
                        values={momentOptions}
                        currentValue={args[1]}
                        onChange={m => onChange([operator, args[0], m, null, args[3]])}
                        keyProperty="key" titleProperty="title"
                    />
                    <FormDropdownList
                        values={bracketOptions}
                        currentValue={args[3]}
                        onChange={b => onChange([operator, args[0], args[1], null, b])}
                        keyProperty="key" titleProperty="title"
                    />
                </>
            )}
        </div>
    )
}
