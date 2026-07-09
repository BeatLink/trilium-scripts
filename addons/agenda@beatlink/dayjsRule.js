// Keep this list in exact lockstep with `dateVars` in
// libagendaoverview@beatlink/libAgendaOverview.js's matchesDayJsCriteria —
// these are the only moment names that DSL actually understands.
export const NAMED_MOMENTS = [
    "now", "startOfToday", "endOfToday", "endOfTomorrow",
    "endOfThisWeek", "endOfThisMonth", "endOfThisYear"
]

// Only these 4 operators appear anywhere in real profile data, even though
// matchesDayJsCriteria will actually call any dayjs method name given to it.
export const OPERATORS = ["isNull", "isBefore", "isAfter", "isBetween"]
export const BRACKETS = ["[]", "[)", "(]", "()"]

export const momentOptions = NAMED_MOMENTS.map(m => ({ key: m, title: m }))
export const operatorOptions = OPERATORS.map(o => ({ key: o, title: o }))
export const bracketOptions = BRACKETS.map(b => ({ key: b, title: b }))

export function defaultForOperator(op) {
    if (op === "isNull") return ["isNull"]
    if (op === "isBetween") return ["isBetween", "startOfToday", "now", null, "[]"]
    return [op, "now"] // isBefore / isAfter
}

// A DayjsRule tuple is `[operator, ...args]` — this splits it back apart,
// defaulting a missing/empty tuple to `["isNull"]` the same way every editor
// column for one of these tuples needs to.
export function splitRule(rule) {
    const [operator, ...args] = rule && rule.length ? rule : ["isNull"]
    return { operator, args }
}
