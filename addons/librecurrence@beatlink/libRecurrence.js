const libRRule = require("rrule.min.js")
const dayjs = api.dayjs

function cleanRRuleString(str) {
    return str
        .replace(/;$/, '')
        .replace("RRULE:", "");
}

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
            ordinal: "1",
            weekday: ""
        },
        stop: {
            type: "never",
            date: dayjs().format("YYYY-MM-DDTHH:mm"),
            count: 1
        },
        loaded: false
    };
}

function RRuleToObj(string){
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
            newState.month.ordinal = String(options.byweekday[0]["n"])
            newState.month.weekday = weekdays[options.byweekday[0]["weekday"]]
        }
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
        if (state.interval === "MONTHLY" &&  state.month.weekday){
            recurrenceData['byweekday'].push(libRRule.RRule[state.month.weekday].nth(Number(state.month.ordinal)))
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

module.exports = {
    cleanRRuleString,
    RRuleToObj,
    ObjToRRule,
    rrule: libRRule
}
