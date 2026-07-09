// Keep this list in exact lockstep with `dateVars` in
// libagendaoverview@beatlink/libAgendaOverview.js's matchesDayJsCriteria —
// these are the only moment names that DSL actually understands.
const NAMED_MOMENTS = [
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

// A DayjsRule tuple is `[operator, ...args]` — this splits it back apart,
// defaulting a missing/empty tuple to `["isNull"]` the same way every editor
// column for one of these tuples needs to.
function splitRule(rule) {
    const [operator, ...args] = rule && rule.length ? rule : ["isNull"]
    return { operator, args }
}

module.exports = {
    NAMED_MOMENTS,
    OPERATORS,
    BRACKETS,
    momentOptions,
    operatorOptions,
    bracketOptions,
    defaultForOperator,
    splitRule
}
