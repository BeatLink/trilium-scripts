# Recurrence

Converts between an RRULE string (as stored on a note's `recurrence` label) and a plain object
shaped for a recurrence-picker UI (interval, weekday toggles, month ordinal/weekday, stop
condition), built on top of the vendored [rrule.js](../librrule@jkbrzt/) library, which this addon
depends on.

## Usage

Install as a dependency and clone the `libRecurrence.js` note as a child of the script that needs
it:

```js
const { RRuleToObj, ObjToRRule, cleanRRuleString, nextOccurrence, rrule } = require("libRecurrence.js")

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

### `nextOccurrence(rruleString, start)`

Given an RRULE string and the date it's currently anchored to, returns
`{ nextDate, recurrence }` — the next occurrence, and the recurrence string to store afterward
(`COUNT` decremented by one, if the rule has one) — or `null` if the recurrence is exhausted (a
`COUNT`/`UNTIL`-bounded rule with nothing left after `start`). This is the building block for a
"mark done, advance to next occurrence" action; see
[`libagendatask@beatlink`](../libagendatask@beatlink/)'s `complete()` and
[`recurrence@beatlink`](../recurrence@beatlink/)'s `markDone.js` for two independent consumers.

### `humanize(rruleString)`

A human-readable sentence for an RRULE string (`"FREQ=WEEKLY"` -> `"Every week"`), via rrule's own
`toText` humanizer, with the first letter capitalized. Returns `""` for empty/unparseable input, so it
can be used directly as a display label value.

### `rrule`

The underlying [rrule.js](../librrule@jkbrzt/) module (`RRule`, `RRuleSet`, `rrulestr`, etc), for
callers that need the raw library directly for something `nextOccurrence` doesn't cover.
