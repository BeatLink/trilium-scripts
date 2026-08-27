/*
 * Liftosaur (https://liftosaur.com) import. Converts either file the app can
 * produce into this addon's database shape:
 *
 *   - the full JSON backup ("Export data to file", `liftosaur-YYYYMMDD.json`),
 *     which is Liftosaur's whole storage document: { settings, history[], ... }
 *   - the history CSV ("Export history to CSV"), one row per set, whose header
 *     starts "Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,..."
 *
 * The CSV names each exercise the way the app displays it ("Bench Press,
 * Barbell") and carries its muscles, while the JSON identifies exercises by
 * their internal camelCase id and only names custom ones -- so a JSON import
 * titles built-in exercises from that id ("benchPress" -> "Bench Press") and has
 * muscles only for custom exercises. Either way the result is exercises plus a
 * workout log; a Liftosaur program is Liftoscript rather than a plain set/rep
 * plan, so none is converted and the import adds no programs of its own.
 *
 * Ids are derived from the source data rather than generated, so importing the
 * same file twice matches what is already there instead of duplicating it.
 */

const KG_PER_LB = 0.45359237

// Only sets that were actually performed are imported; warmups and untouched
// sets are counted so the caller can say what was left out.
function emptySummary() {
    return { exercises: 0, workouts: 0, sets: 0, warmupSets: 0, incompleteSets: 0, unit: "kg" }
}

function slug(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
}

// "benchPress" -> "Bench Press", "tBarRow" -> "T Bar Row".
function titleCase(id) {
    return String(id)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, c => c.toUpperCase())
}

function toNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 0
}

// Liftosaur stores each weight with its own unit, so a file whose sets mix kg
// and lb is converted onto the one unit the whole import is reported in.
function convertWeight(value, from, to) {
    const number = toNumber(value)
    if (!number || !from || from === to) return number
    return to === "kg" ? number * KG_PER_LB : number / KG_PER_LB
}

function isoDate(value, fallbackMs) {
    const date = new Date(value ?? fallbackMs ?? NaN)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
}

/*
 * An exercise as this addon stores it, accumulated across every set that
 * mentions it. Bodyweight movements that never carried added weight are
 * recorded as bodyweight reps; everything else Liftosaur logs is weight and
 * reps, since it has no duration or distance tracking.
 */
function upsertExercise(exercises, key, fields) {
    const id = `lft-${slug(key)}`
    const existing = exercises[id]
    const merged = {
        id,
        name: fields.name || existing?.name || "",
        measurement: "weight",
        equipment: fields.equipment ?? existing?.equipment ?? "",
        muscles: [...new Set([...(existing?.muscles || []), ...(fields.muscles || [])])],
        comment: "",
        tags: [...new Set([...(existing?.tags || []), ...(fields.tags || [])])],
        // Not part of the stored shape; dropped once the measurement is decided.
        bodyweight: (existing?.bodyweight ?? true) && fields.bodyweight !== false
    }
    exercises[id] = merged
    return id
}

function finalizeExercises(exercises) {
    const final = {}
    for (const [id, exercise] of Object.entries(exercises)) {
        const { bodyweight, ...rest } = exercise
        final[id] = { ...rest, measurement: bodyweight ? "bodyweight" : "weight" }
    }
    return final
}

// Sets land under the session's entry for that exercise, in the order they appear.
function pushSet(session, exerciseId, set, notes) {
    let entry = session.entries.find(candidate => candidate.exerciseId === exerciseId)
    if (!entry) {
        entry = { id: `${session.id}-${exerciseId}`, exerciseId, comment: notes || "", sets: [] }
        session.entries.push(entry)
    }
    if (notes && !entry.comment) entry.comment = notes
    entry.sets.push({ id: `${entry.id}-${entry.sets.length + 1}`, ...set })
}

// =========================================================================
// JSON backup
// =========================================================================

function convertStorage(storage) {
    const summary = { ...emptySummary(), unit: storage.settings?.units === "lb" ? "lb" : "kg" }
    const custom = storage.settings?.exercises || {}
    const exercises = {}
    const log = {}

    for (const record of storage.history || []) {
        const date = isoDate(record?.date, record?.startTime)
        if (!date) continue
        const session = {
            id: `lft-${record.id ?? slug(record.date)}`,
            name: record.dayName || record.programName || "Workout",
            sessionId: "",
            startedAt: new Date(record.startTime || Date.parse(record.date) || Date.now()).toISOString(),
            comment: "",
            entries: []
        }

        for (const entry of record.entries || []) {
            const exerciseId = entry?.exercise?.id
            if (!exerciseId) continue
            const equipment = entry.exercise.equipment || ""
            const customExercise = custom[exerciseId]
            const meta = customExercise?.meta || {}
            const id = upsertExercise(exercises, `${exerciseId}-${equipment}`, {
                name: [customExercise?.name || titleCase(exerciseId), equipment && equipment !== "bodyweight" ? titleCase(equipment) : ""]
                    .filter(Boolean).join(", "),
                equipment: equipment && equipment !== "bodyweight" ? titleCase(equipment) : "",
                muscles: [...(meta.targetMuscles || []), ...(meta.synergistMuscles || [])],
                bodyweight: equipment === "bodyweight"
            })

            summary.warmupSets += (entry.warmupSets || []).length
            for (const set of entry.sets || []) {
                // `reps` is the target and `completedReps` what was actually
                // done, so a set without the latter was never performed.
                const reps = set.completedReps
                if (reps == null) {
                    summary.incompleteSets += 1
                    continue
                }
                const weight = set.completedWeight ?? set.weight
                const value = convertWeight(weight?.value, weight?.unit, summary.unit)
                if (value > 0) exercises[id].bodyweight = false
                pushSet(session, id, {
                    reps: toNumber(reps),
                    weight: value,
                    duration: 0,
                    distance: 0,
                    rpe: toNumber(set.completedRpe ?? set.rpe)
                }, entry.notes)
                summary.sets += 1
            }
        }

        if (session.entries.length === 0) continue
        log[date] = [...(log[date] || []), session]
        summary.workouts += 1
    }

    const finalExercises = finalizeExercises(exercises)
    summary.exercises = Object.keys(finalExercises).length
    return { database: { categories: [], exercises: finalExercises, programs: {}, log }, summary }
}

// =========================================================================
// History CSV
// =========================================================================

// RFC 4180: fields may be quoted, quotes double themselves, and a quoted field
// may hold commas and newlines.
function parseCsv(text) {
    const rows = []
    let row = []
    let field = ""
    let quoted = false
    const source = String(text).replace(/\r\n/g, "\n")

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]
        if (quoted) {
            if (char !== '"') field += char
            else if (source[index + 1] === '"') { field += '"'; index += 1 }
            else quoted = false
        } else if (char === '"') {
            quoted = true
        } else if (char === ",") {
            row.push(field)
            field = ""
        } else if (char === "\n") {
            row.push(field)
            rows.push(row)
            row = []
            field = ""
        } else {
            field += char
        }
    }
    if (field || row.length > 0) {
        row.push(field)
        rows.push(row)
    }
    return rows.filter(entries => entries.some(value => value.trim() !== ""))
}

// "Bench Press, Barbell" -> name and equipment; a name without equipment stays whole.
function splitExerciseName(fullName) {
    const separator = fullName.lastIndexOf(", ")
    if (separator < 0) return { name: fullName, equipment: "" }
    return { name: fullName.slice(0, separator).trim(), equipment: fullName.slice(separator + 2).trim() }
}

function splitMuscles(value) {
    return String(value || "").split(",").map(name => name.trim()).filter(Boolean)
}

function convertCsv(text) {
    const rows = parseCsv(text)
    const header = rows[0] || []
    const column = name => header.indexOf(name)
    if (column("Workout DateTime") < 0 || column("Exercise") < 0) {
        throw new Error("That CSV doesn't look like a Liftosaur history export.")
    }

    const summary = emptySummary()
    const exercises = {}
    const log = {}
    const sessions = new Map()
    const cell = (row, name) => {
        const index = column(name)
        return index >= 0 ? row[index] : ""
    }

    // Everything is reported in the first unit the file names, so the choice
    // doesn't depend on which rows happen to carry weight.
    const firstUnit = rows.slice(1)
        .map(row => (cell(row, "Completed Weight Unit") || cell(row, "Required Weight Unit")).trim())
        .find(Boolean)
    if (firstUnit) summary.unit = firstUnit === "lb" ? "lb" : "kg"

    for (const row of rows.slice(1)) {
        const dateTime = cell(row, "Workout DateTime")
        const date = isoDate(dateTime)
        const fullName = cell(row, "Exercise").trim()
        if (!date || !fullName) continue
        if (cell(row, "Is Warmup Set?") === "1") {
            summary.warmupSets += 1
            continue
        }

        const completedReps = cell(row, "Completed Reps")
        if (completedReps === "" || completedReps == null) {
            summary.incompleteSets += 1
            continue
        }

        const { name, equipment } = splitExerciseName(fullName)
        const id = upsertExercise(exercises, fullName, {
            name: fullName,
            equipment,
            muscles: [...splitMuscles(cell(row, "Target Muscles")), ...splitMuscles(cell(row, "Synergist Muscles"))],
            bodyweight: true
        })

        const unit = (cell(row, "Completed Weight Unit") || cell(row, "Required Weight Unit") || summary.unit).trim()
        const rawWeight = cell(row, "Completed Weight Value") || cell(row, "Required Weight Value")
        const weight = convertWeight(rawWeight, unit, summary.unit)
        if (weight > 0) exercises[id].bodyweight = false

        const key = dateTime
        if (!sessions.has(key)) {
            sessions.set(key, {
                id: `lft-${slug(dateTime)}`,
                name: cell(row, "Day Name") || cell(row, "Program") || "Workout",
                sessionId: "",
                startedAt: new Date(dateTime).toISOString(),
                comment: "",
                entries: []
            })
        }
        const session = sessions.get(key)
        pushSet(session, id, {
            reps: toNumber(completedReps),
            weight,
            duration: 0,
            distance: 0,
            rpe: toNumber(cell(row, "Completed RPE") || cell(row, "Required RPE"))
        }, cell(row, "Notes"))
        summary.sets += 1
        session.date = date
    }

    for (const session of sessions.values()) {
        const { date, ...rest } = session
        if (!date || rest.entries.length === 0) continue
        log[date] = [...(log[date] || []), rest]
        summary.workouts += 1
    }

    const finalExercises = finalizeExercises(exercises)
    summary.exercises = Object.keys(finalExercises).length
    return { database: { categories: [], exercises: finalExercises, programs: {}, log }, summary }
}

/*
 * Entry point: takes the text of either export and returns
 * `{ database, summary }`. Throws with something the user can act on if the file
 * is neither.
 */
function convertLiftosaurExport(text) {
    const trimmed = String(text || "").trim()
    if (!trimmed) throw new Error("The file is empty.")
    if (trimmed.startsWith("{")) {
        let storage
        try {
            storage = JSON.parse(trimmed)
        } catch {
            throw new Error("That file starts like JSON but isn't valid JSON.")
        }
        if (!Array.isArray(storage?.history)) {
            throw new Error("That JSON has no `history` array — export with Liftosaur's \"Export data to file\".")
        }
        return convertStorage(storage)
    }
    return convertCsv(trimmed)
}

module.exports = { convertLiftosaurExport, parseCsv, titleCase, convertWeight }
