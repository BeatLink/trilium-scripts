# Recurrence

Converts between an RRULE string (as stored on a note's `recurrence` label) and a plain object
shaped for a recurrence-picker UI (interval, weekday toggles, month ordinal/weekday, stop
condition), built on top of the vendored [rrule.js](../librrule@jkbrzt/) library, which this addon
depends on.

## Usage

Install as a dependency and clone the `libRecurrence.js` note as a child of the script that needs
it:

```js
const { RRuleToObj, ObjToRRule, cleanRRuleString, rrule } = require("libRecurrence.js")

const recurrenceObj = RRuleToObj(note.getLabelValue("recurrence"))
const rruleString = ObjToRRule(recurrenceObj)
```

## API

### `RRuleToObj(rruleString)`

Parses an RRULE string into a plain object:

```js
{
    enabled: true,
    intervalCount: 1,
    interval: "WEEKLY",           // MINUTELY | HOURLY | DAILY | WEEKLY | MONTHLY | YEARLY
    weeks: { SU, MO, TU, WE, TH, FR, SA },  // booleans, only meaningful when interval === "WEEKLY"
    month: { ordinal, weekday },            // only meaningful when interval === "MONTHLY"
    stop: { type, date, count }             // type: "never" | "date" | "number"
}
```

Returns a disabled default object (`enabled: false`) when passed an empty/falsy string.

### `ObjToRRule(recurrenceObj)`

The inverse of `RRuleToObj` — returns an RRULE string, or `null` when `enabled` is `false`.

### `cleanRRuleString(str)`

Strips the `RRULE:` prefix and a trailing semicolon from a raw rrule.js-generated string.

### `rrule`

The underlying [rrule.js](../librrule@jkbrzt/) module (`RRule`, `RRuleSet`, `rrulestr`, etc), for
callers that need the raw library directly (e.g. computing the next occurrence of a recurring task).
