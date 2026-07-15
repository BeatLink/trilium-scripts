const libRRule = require("rrule.min.js")
const dayjs = api.dayjs

function cleanRRuleString(str) {
    return str
        .replace(/;$/, '')
        .replace("RRULE:", "");
}

function RRuleToObj(string){
    function createDefaultRecurrenceObj() {
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
        };
    }
    let newState = createDefaultRecurrenceObj()
    const weekdays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    if (string){
        let options = libRRule.RRule.parseString(string)
        newState.enabled = true
        newState.intervalCount = options.interval || 1
        newState.interval =
            Object.keys(libRRule.RRule)
            .filter(k => typeof libRRule.RRule[k] === 'number')
            .find(k => libRRule.RRule[k] === options.freq)
        if (newState.interval === 'WEEKLY' && options.byweekday){
            for (const day of options.byweekday) {
                newState.weeks[weekdays[day["weekday"]]] = true
            }
        } else if (newState.interval === 'MONTHLY' && options.byweekday){
            newState.month.mode = "weekday"
            newState.month.ordinal = String(options.byweekday[0]["n"])
            newState.month.weekday = weekdays[options.byweekday[0]["weekday"]]
        } else if (newState.interval === 'MONTHLY' && options.bymonthday != null){
            const monthday = Array.isArray(options.bymonthday) ? options.bymonthday[0] : options.bymonthday
            newState.month.mode = "day"
            newState.month.day = String(monthday)
        }
        const byhour = Array.isArray(options.byhour) ? options.byhour[0] : options.byhour
        const byminute = Array.isArray(options.byminute) ? options.byminute[0] : options.byminute
        if (byhour != null) newState.time.hour = String(byhour)
        if (byminute != null) newState.time.minute = String(byminute)
        if (options.until){
            newState.stop.type = 'date'
            newState.stop.date = dayjs(options.until).format("YYYY-MM-DDTHH:mm")
        } else if (options.count){
            newState.stop.type = 'number'
            newState.stop.count = options.count
        } else {
            newState.stop.type = 'never'
        }
    } else {
        newState.enabled = false
    }
    return newState
}

function ObjToRRule(state){
    let string = ""
    if (state.enabled) {
        let recurrenceData = {
            freq: libRRule.RRule[state.interval],
            interval: state.intervalCount,
            byweekday: []
        }
        if (state.interval === "WEEKLY"){
            recurrenceData['byweekday'] =
                Object.entries(state.weeks)
                .filter(([weekday, enabled]) => (enabled))
                .map(([weekday, enabled]) => libRRule.RRule[weekday])
        }
        if (state.interval === "MONTHLY") {
            if (state.month.mode === "weekday" && state.month.weekday) {
                recurrenceData['byweekday'].push(libRRule.RRule[state.month.weekday].nth(Number(state.month.ordinal)))
            } else if (state.month.mode === "day" && state.month.day !== "" && state.month.day != null) {
                recurrenceData['bymonthday'] = Number(state.month.day)
            }
        }
        if (state.time.hour !== "" && state.time.hour != null) {
            recurrenceData['byhour'] = Number(state.time.hour)
        }
        if (state.time.minute !== "" && state.time.minute != null) {
            recurrenceData['byminute'] = Number(state.time.minute)
        }
        if (state.stop.type === "number"){
            recurrenceData['count'] = Number(state.stop.count)
        }
        if (state.stop.type === "date" && state.stop.date) {
            recurrenceData["until"] = dayjs(state.stop.date).utc().toDate()
        }
        string = cleanRRuleString(libRRule.RRule.optionsToString(recurrenceData))
    }
    return string ? string : null
}

function nextOccurrence(recurrenceString, start) {
    const options = libRRule.RRule.parseString(recurrenceString)
    options.dtstart = start
    const rule = new libRRule.RRule(options)
    const nextDate = rule.after(start, false)
    if (!nextDate) return null

    const updatedOptions = libRRule.RRule.parseString(recurrenceString)
    if (updatedOptions.count) updatedOptions.count -= 1
    const recurrence = cleanRRuleString(libRRule.RRule.optionsToString(updatedOptions))

    return { nextDate, recurrence }
}

function humanize(recurrenceString) {
    if (!recurrenceString) return ""
    try {
        const options = libRRule.RRule.parseString(recurrenceString)
        const text = new libRRule.RRule(options).toText()
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
    } catch (e) {
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
