/* 
    Set this as a JS Frontend Script
    Set the label #customResourceProvider="recurrencelib.js"
*/

// Constants --------------------------------------------------------------------------------
const intervalList = ["minute", "hour", "day", "week", "month", "year"]
const monthOrdinalList = ["first", "second", "third", "fourth", "last"]
const weekdayList = ["none", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const stopTypeList = ["never", "number", "date"]


// Recurrence Class --------------------------------------------------------------------------
class Recurrence {    
    constructor(){
        this.enabled = false
        this.interval = 'minute'
        this.intervalNumber = 1
        this.weekSunday = false
        this.weekMonday = false
        this.weekTuesday = false
        this.weekWednesday = false
        this.weekThursday = false
        this.weekFriday = false
        this.weekSaturday = false
        this.monthOrdinal = 'first'
        this.monthWeekday = ''
        this.stopType = 'never'
        this.stopDate = null
        this.stopNumber = 1
        this.weekdayStrings = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

    }

    getNextDate(initial){
        if (this.enabled){
            var next = new Date(initial.getTime());
            if (this.interval == 'minute') {
                next.setMinutes(initial.getMinutes() + this.intervalNumber)
            } else if (this.interval == 'hour') {
                next.setHours(initial.getHours() + this.intervalNumber)
            } else if (this.interval == 'day') {
                next.setDate(initial.getDate() + this.intervalNumber)
            } else if (this.interval == 'week') {
                next.setDate(next.getDate() + this.intervalNumber * 7)
                if (this.getWeekdaysInt().length > 0){
                    var validWeekdays = this.getWeekdays(initial).concat(this.getWeekdays(next))
                    validWeekdays.sort((a,b)=>{return a.getTime()-b.getTime()})
                    for (var weekDate of validWeekdays){
                        if (weekDate.getTime() > initial.getTime()){
                            next.setTime(weekDate.getTime())
                            break
                        }
                    }
                }
            } else if (this.interval == 'month') {
                next.setMonth(initial.getMonth() + this.intervalNumber)
                if (this.monthWeekday != "none"){
                    var initialDate = new Date(this.getMonthWeekday(initial))
                    var nextDate = new Date(this.getMonthWeekday(next))
                    var validMonthDates = [initialDate, nextDate]
                    validMonthDates.sort((a,b)=>{return a.getTime()-b.getTime()})
                    for (var monthDate of validMonthDates){
                        if (monthDate > initial){
                            next.setTime(monthDate.getTime())
                            break
                        }
                    }
                }
            } else if (this.interval == 'year') {
                next.setFullYear(initial.getFullYear() + this.intervalNumber)
            }
            return next;
        }
    }

    getNextDateAfter(initial, after){
        if (this.enabled){
            var newDate = initial
            while (newDate < after) {
                newDate = this.getNextDate(newDate)
                console.log(`newDate ${newDate}`)
            }    
        }
    }

    updateStopStatus(){
        if (this.stopType == 'date' && new Date(this.stopDate) < new Date()){
            this.enabled = false
        } else if (this.stopType == 'number'){
            if (this.stopNumber <= 1){
                this.enabled = false
            } else {
                this.stopNumber = this.stopNumber - 1
            }
        }
    }

    getWeekdays(date){
        return this.getWeekdaysInt().map((weekday) => {
            var newDate = new Date(date)
            newDate.setDate(newDate.getDate() - newDate.getDay() + weekday)
            return newDate
        })
    }


     getWeekdaysInt(){
        var weekArray = []
        if (this.weekSunday == true) {weekArray.push(0)}
        if (this.weekMonday == true) {weekArray.push(1)}
        if (this.weekTuesday == true) {weekArray.push(2)}
        if (this.weekWednesday == true) {weekArray.push(3)}
        if (this.weekThursday == true) {weekArray.push(4)}
        if (this.weekFriday == true) {weekArray.push(5)}
        if (this.weekSaturday == true) {weekArray.push(6)}
        return weekArray
    } 

    async getMonthWeekday(date){
        var ordinal = this.monthOrdinalList.indexOf(this.monthOrdinal)
        var weekday = this.weekdayStrings.indexOf(this.monthWeekday)
        var weekdays = [];
        var startDate = new Date(date)
        var currentMonth = startDate.getMonth()
        startDate.setDate(1)
        while (startDate.getMonth() === currentMonth) {
            if (startDate.getDay() == weekday){
                weekdays.push(new Date(startDate));
            }
            startDate.setDate(startDate.getDate() + 1);
        }
        if (ordinal == 4){
            return weekdays.pop()
        } else {
            return weekdays[ordinal]
        }
    }
}

function recurrenceToJSON(recurrence) {
    return JSON.stringify({
        enabled: recurrence.enabled,
        interval: recurrence.interval,
        intervalNumber: recurrence.intervalNumber,
        weekSunday: recurrence.weekSunday,
        weekMonday: recurrence.weekMonday,
        weekTuesday: recurrence.weekTuesday,
        weekWednesday: recurrence.weekWednesday,
        weekThursday: recurrence.weekThursday,
        weekFriday: recurrence.weekFriday,
        weekSaturday: recurrence.weekSaturday,
        monthOrdinal: recurrence.monthOrdinal,
        monthWeekday: recurrence.monthWeekday,
        stopType: recurrence.stopType,
        stopDate: recurrence.stopDate,
        stopNumber: recurrence.stopNumber,
    }, null, 4);
}

function recurrenceFromJSON(JSONstring) {
    var parsedJSON = JSON.parse(JSONstring)
    var recurrence = new exports.Recurrence()
    recurrence.enabled = Boolean(parsedJSON.enabled)
    recurrence.intervalNumber = Number(parsedJSON.intervalNumber)
    recurrence.interval = String(parsedJSON.interval)
    recurrence.weekSunday = Boolean(parsedJSON.weekSunday)
    recurrence.weekMonday = Boolean(parsedJSON.weekMonday)
    recurrence.weekTuesday = Boolean(parsedJSON.weekTuesday)
    recurrence.weekWednesday = Boolean(parsedJSON.weekWednesday)
    recurrence.weekThursday = Boolean(parsedJSON.weekThursday)
    recurrence.weekFriday = Boolean(parsedJSON.weekFriday)
    recurrence.weekSaturday = Boolean(parsedJSON.weekSaturday)
    recurrence.monthOrdinal = String(parsedJSON.monthOrdinal)
    recurrence.monthWeekday = String(parsedJSON.monthWeekday)
    recurrence.stopType = String(parsedJSON.stopType)
    recurrence.stopDate = String(parsedJSON.stopDate)
    recurrence.stopNumber = Number(parsedJSON.stopNumber)
    return recurrence
}

exports = { Recurrence, recurrenceToJSON, recurrenceFromJSON}