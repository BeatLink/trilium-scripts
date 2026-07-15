const libRRule = require("rrule.min.js")
const dayjs = api.dayjs

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

function cleanRRuleString(rruleString) {
    return rruleString
        .replace(/;$/, '')
        .replace("RRULE:", "")
}

// Maps an rrule numeric frequency (e.g. RRule.WEEKLY) back to its name string.
function frequencyName(frequencyNumber) {
    return Object.keys(libRRule.RRule)
        .filter(key => typeof libRRule.RRule[key] === 'number')
        .find(key => libRRule.RRule[key] === frequencyNumber)
}

function firstOf(value) {
    return Array.isArray(value) ? value[0] : value
}

function createDefaultRecurrenceState() {
    return {
        enabled: false,
        intervalCount: 1,
        interval: "DAILY",
        weeks: {
            SU: false, MO: false, TU: false,
            WE: false, TH: false, FR: false, SA: false
        },
        month: {
            mode: "day",
            day: "",
            ordinal: "1",
            weekday: ""
        },
        time: {
            hour: "",
            minute: ""
        },
        stop: {
            type: "never",
            date: dayjs().format("YYYY-MM-DDTHH:mm"),
            count: 1
        },
        loaded: false
    }
}

function applyWeeklyOptions(state, options) {
    if (!options.byweekday) return
    for (const day of options.byweekday) {
        state.weeks[WEEKDAY_CODES[day.weekday]] = true
    }
}

function applyMonthlyOptions(state, options) {
    if (options.byweekday) {
        state.month.mode = "weekday"
        state.month.ordinal = String(options.byweekday[0].n)
        state.month.weekday = WEEKDAY_CODES[options.byweekday[0].weekday]
    } else if (options.bymonthday != null) {
        state.month.mode = "day"
        state.month.day = String(firstOf(options.bymonthday))
    }
}

function applyTimeOptions(state, options) {
    const hour = firstOf(options.byhour)
    const minute = firstOf(options.byminute)
    if (hour != null) state.time.hour = String(hour)
    if (minute != null) state.time.minute = String(minute)
}

function applyStopOptions(state, options) {
    if (options.until) {
        state.stop.type = "date"
        state.stop.date = dayjs(options.until).format("YYYY-MM-DDTHH:mm")
    } else if (options.count) {
        state.stop.type = "number"
        state.stop.count = options.count
    } else {
        state.stop.type = "never"
    }
}

function RRuleToObj(rruleString) {
    const state = createDefaultRecurrenceState()
    if (!rruleString) return state

    const options = libRRule.RRule.parseString(rruleString)
    state.enabled = true
    state.intervalCount = options.interval || 1
    state.interval = frequencyName(options.freq)

    if (state.interval === "WEEKLY") applyWeeklyOptions(state, options)
    if (state.interval === "MONTHLY") applyMonthlyOptions(state, options)
    applyTimeOptions(state, options)
    applyStopOptions(state, options)

    return state
}

function buildRRuleOptions(state) {
    const options = {
        freq: libRRule.RRule[state.interval],
        interval: state.intervalCount,
        byweekday: []
    }

    if (state.interval === "WEEKLY") {
        options.byweekday = Object.entries(state.weeks)
            .filter(([, enabled]) => enabled)
            .map(([weekday]) => libRRule.RRule[weekday])
    }

    if (state.interval === "MONTHLY") {
        const usesWeekday = state.month.mode === "weekday" && state.month.weekday
        const usesMonthDay = state.month.mode === "day" && state.month.day !== "" && state.month.day != null
        if (usesWeekday) {
            options.byweekday.push(libRRule.RRule[state.month.weekday].nth(Number(state.month.ordinal)))
        } else if (usesMonthDay) {
            options.bymonthday = Number(state.month.day)
        }
    }

    if (state.time.hour !== "" && state.time.hour != null) options.byhour = Number(state.time.hour)
    if (state.time.minute !== "" && state.time.minute != null) options.byminute = Number(state.time.minute)

    if (state.stop.type === "number") options.count = Number(state.stop.count)
    if (state.stop.type === "date" && state.stop.date) options.until = dayjs(state.stop.date).utc().toDate()

    return options
}

function ObjToRRule(state) {
    if (!state.enabled) return null
    const options = buildRRuleOptions(state)
    const rruleString = cleanRRuleString(libRRule.RRule.optionsToString(options))
    return rruleString || null
}

function nextOccurrence(recurrenceString, startDate) {
    const options = libRRule.RRule.parseString(recurrenceString)
    options.dtstart = startDate
    const rule = new libRRule.RRule(options)
    const nextDate = rule.after(startDate, false)
    if (!nextDate) return null

    // Rebuild the recurrence with a decremented count so a bounded series
    // shrinks by one each time an occurrence is consumed.
    const remainingOptions = libRRule.RRule.parseString(recurrenceString)
    if (remainingOptions.count) remainingOptions.count -= 1
    const recurrence = cleanRRuleString(libRRule.RRule.optionsToString(remainingOptions))

    return { nextDate, recurrence }
}

function humanize(recurrenceString) {
    if (!recurrenceString) return ""
    try {
        const options = libRRule.RRule.parseString(recurrenceString)
        const text = new libRRule.RRule(options).toText()
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
    } catch (error) {
        return ""
    }
}

module.exports = {
    cleanRRuleString,
    RRuleToObj,
    ObjToRRule,
    nextOccurrence,
    humanize,
    rrule: libRRule
}
