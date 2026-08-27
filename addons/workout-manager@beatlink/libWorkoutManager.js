/*
 * Workout Manager data model. Pure functions over the JSON document stored in
 * the addon's persisted Database note:
 *   {
 *     categories: [ "Push", "Push/Chest", ... ],
 *     exercises: { [id]: { id, name, measurement, equipment, muscles: [...], comment, tags: [...] } },
 *     programs: { [id]: { id, name, comment, sessions: [ { id, name, comment, tags: [...], entries: [{ id, exerciseId, sets, reps, weight, duration, distance, rest, comment }] } ] } },
 *     log: { [date]: [ { id, name, sessionId, startedAt, comment, entries: [ { id, exerciseId, comment, sets: [ { id, reps, weight, duration, distance, rpe } ] } ] } ] }
 *   }
 * A program is an ordered group of sessions -- Program -> Session -> Exercise.
 * A session is a plan; a log entry is one workout actually performed, pointing
 * back at the session it was started from via `sessionId` (empty when ad-hoc).
 * Session ids are unique across every program, so a workout needs no program id.
 * `date` is an ISO "YYYY-MM-DD" string. Weights and distances are plain numbers
 * in whatever unit settings names (kg/lb, km/mi) -- the unit is a display label,
 * never a conversion, so changing it never rewrites recorded numbers. Durations
 * are minutes.
 */

/*
 * How one exercise is measured, which decides both the fields a set carries and
 * what a personal best means for it. Everything else in the model is shared:
 * a set record always has every field, the unused ones simply stay 0.
 */
const MEASUREMENTS = [
    { key: "weight", label: "Weight & Reps", fields: ["reps", "weight"] },
    { key: "bodyweight", label: "Bodyweight Reps", fields: ["reps"] },
    { key: "duration", label: "Duration", fields: ["duration"] },
    { key: "cardio", label: "Cardio", fields: ["duration", "distance"] }
]

const SET_FIELDS = [
    { key: "reps", label: "Reps", unitless: true },
    { key: "weight", label: "Weight", unit: "weight" },
    { key: "duration", label: "Duration (min)", unitless: true },
    { key: "distance", label: "Distance", unit: "distance" }
]

function newId() {
    return Math.random().toString(36).slice(2, 10)
}

function measurementOf(exercise) {
    const key = exercise?.measurement
    return MEASUREMENTS.find(m => m.key === key) || MEASUREMENTS[0]
}

// The set fields that matter for this exercise, in display order.
function measurementFields(exercise) {
    const fields = measurementOf(exercise).fields
    return SET_FIELDS.filter(field => fields.includes(field.key))
}

/*
 * Categories nest by path: "Push/Chest" is Chest inside Push. The path string is
 * the whole identity -- there are no category records to keep in step with it --
 * so a flat name is simply a depth-1 path.
 */
const CATEGORY_SEPARATOR = "/"

function normalizeCategoryName(raw) {
    if (typeof raw !== "string") return ""
    return raw.split(CATEGORY_SEPARATOR).map(segment => segment.trim()).filter(Boolean).join(CATEGORY_SEPARATOR)
}

// Category tags: path-normalized, de-duplicated case-insensitively, kept sorted,
// which also puts every parent directly before its children.
function normalizeTags(raw) {
    if (!Array.isArray(raw)) return []
    const byLower = new Map()
    for (const tag of raw) {
        const name = normalizeCategoryName(tag)
        if (name && !byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name)
    }
    return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

function categorySegments(name) {
    return name.split(CATEGORY_SEPARATOR)
}

function categoryDepth(name) {
    return categorySegments(name).length - 1
}

function categoryLeaf(name) {
    return categorySegments(name).at(-1)
}

// "A/B/C" -> ["A", "A/B"]: the categories it implicitly belongs to.
function categoryAncestors(name) {
    const segments = categorySegments(name)
    return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join(CATEGORY_SEPARATOR))
}

// A tag counts as being in a category when it is that category or nested under it.
function isInCategory(tag, category) {
    return tag === category || tag.startsWith(`${category}${CATEGORY_SEPARATOR}`)
}

function positiveNumber(raw, fallback) {
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeNumber(raw) {
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
}

function trimmedString(raw) {
    return typeof raw === "string" ? raw.trim() : ""
}

// Muscles worked: free text, de-duplicated case-insensitively, kept sorted.
function normalizeNames(raw) {
    if (!Array.isArray(raw)) return []
    const byLower = new Map()
    for (const name of raw) {
        const trimmed = trimmedString(name)
        if (trimmed && !byLower.has(trimmed.toLowerCase())) byLower.set(trimmed.toLowerCase(), trimmed)
    }
    return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

function normalizeExercise(exercise) {
    return {
        id: typeof exercise?.id === "string" && exercise.id ? exercise.id : newId(),
        name: typeof exercise?.name === "string" ? exercise.name : "",
        measurement: MEASUREMENTS.some(m => m.key === exercise?.measurement) ? exercise.measurement : "weight",
        equipment: trimmedString(exercise?.equipment),
        muscles: normalizeNames(exercise?.muscles),
        comment: trimmedString(exercise?.comment),
        tags: normalizeTags(exercise?.tags)
    }
}

/*
 * A session entry is the plan for one exercise: how many sets, and the targets
 * each of them aims at. Which targets are meaningful follows the exercise's
 * measurement, exactly as it does for a logged set.
 */
function normalizeSessionEntry(entry) {
    return {
        id: typeof entry?.id === "string" && entry.id ? entry.id : newId(),
        exerciseId: typeof entry?.exerciseId === "string" ? entry.exerciseId : "",
        sets: positiveNumber(entry?.sets, 3),
        reps: nonNegativeNumber(entry?.reps),
        weight: nonNegativeNumber(entry?.weight),
        duration: nonNegativeNumber(entry?.duration),
        distance: nonNegativeNumber(entry?.distance),
        rest: nonNegativeNumber(entry?.rest),
        comment: trimmedString(entry?.comment)
    }
}

function normalizeSession(session) {
    return {
        id: typeof session?.id === "string" && session.id ? session.id : newId(),
        name: typeof session?.name === "string" ? session.name : "",
        comment: trimmedString(session?.comment),
        tags: normalizeTags(session?.tags),
        entries: Array.isArray(session?.entries) ? session.entries.map(normalizeSessionEntry) : []
    }
}

// A program is an ordered group of sessions; the array order is the running order.
function normalizeProgram(program) {
    return {
        id: typeof program?.id === "string" && program.id ? program.id : newId(),
        name: typeof program?.name === "string" ? program.name : "",
        comment: trimmedString(program?.comment),
        sessions: Array.isArray(program?.sessions) ? program.sessions.map(normalizeSession) : []
    }
}

function normalizeSet(set) {
    return {
        id: typeof set?.id === "string" && set.id ? set.id : newId(),
        reps: nonNegativeNumber(set?.reps),
        weight: nonNegativeNumber(set?.weight),
        duration: nonNegativeNumber(set?.duration),
        distance: nonNegativeNumber(set?.distance),
        rpe: nonNegativeNumber(set?.rpe)
    }
}

function normalizeWorkoutEntry(entry) {
    return {
        id: typeof entry?.id === "string" && entry.id ? entry.id : newId(),
        exerciseId: typeof entry?.exerciseId === "string" ? entry.exerciseId : "",
        comment: trimmedString(entry?.comment),
        sets: Array.isArray(entry?.sets) ? entry.sets.map(normalizeSet) : []
    }
}

// One workout: a named list of exercises with the sets actually performed.
function normalizeWorkout(workout) {
    return {
        id: typeof workout?.id === "string" && workout.id ? workout.id : newId(),
        name: typeof workout?.name === "string" ? workout.name : "Workout",
        // Empty means an ad-hoc workout that came from no session.
        // Pre-programs documents named this `routineId`; ids survive migration.
        sessionId: typeof workout?.sessionId === "string" ? workout.sessionId
            : typeof workout?.routineId === "string" ? workout.routineId : "",
        startedAt: typeof workout?.startedAt === "string" ? workout.startedAt : new Date().toISOString(),
        comment: trimmedString(workout?.comment),
        entries: Array.isArray(workout?.entries) ? workout.entries.map(normalizeWorkoutEntry) : []
    }
}

// Every session in the document, each paired with the program that owns it.
function allSessions(database) {
    return Object.values(database.programs).flatMap(program => program.sessions.map(session => ({ program, session })))
}

// The session with this id, and its program, or null when nothing matches.
function findSession(database, sessionId) {
    return allSessions(database).find(({ session }) => session.id === sessionId) || null
}

// Exercises and sessions are both taggable and are treated alike wherever categories are concerned.
function taggedItems(database) {
    return [...Object.values(database.exercises), ...allSessions(database).map(({ session }) => session)]
}

/*
 * The category list is the union of the explicitly managed `categories` array,
 * whatever tags items actually carry, and every ancestor those paths imply. So a
 * category created but not yet used still shows up, a tag that only exists on an
 * item is never hidden, and tagging something "A/B" makes "A" exist too.
 */
function allCategories(database) {
    const used = [...database.categories, ...taggedItems(database).flatMap(item => item.tags)]
    return normalizeTags(used.flatMap(name => [name, ...categoryAncestors(name)]))
}

// Items tagged with this exact category, and (with descendants) its whole subtree.
function categoryUsage(database, name, includeDescendants = false) {
    const matches = tags => includeDescendants ? tags.some(tag => isInCategory(tag, name)) : tags.includes(name)
    return {
        exercises: Object.values(database.exercises).filter(exercise => matches(exercise.tags)).length,
        sessions: allSessions(database).filter(({ session }) => matches(session.tags)).length
    }
}

function addCategory(database, name) {
    return { ...database, categories: normalizeTags([...database.categories, name]) }
}

// Maps every tag of every exercise and of every session inside every program.
function mapItemTags(database, mapTags) {
    const retag = item => ({ ...item, tags: normalizeTags(mapTags(item.tags)) })
    const exercises = {}
    for (const [id, exercise] of Object.entries(database.exercises)) exercises[id] = retag(exercise)
    const programs = {}
    for (const [id, program] of Object.entries(database.programs)) {
        programs[id] = { ...program, sessions: program.sessions.map(retag) }
    }
    return { ...database, exercises, programs }
}

/*
 * Renaming moves the subtree with it: renaming "Push" to "Upper/Push" takes
 * "Push/Chest" along as "Upper/Push/Chest". Renaming onto a name that already
 * exists merges the two, since normalizeTags drops the duplicate.
 */
function renameCategory(database, from, to) {
    const target = normalizeCategoryName(to)
    if (!target) return database
    const rename = tags => tags.map(tag => isInCategory(tag, from) ? target + tag.slice(from.length) : tag)
    const renamed = mapItemTags(database, rename)
    return { ...renamed, categories: normalizeTags(rename(database.categories)) }
}

// Deleting takes the subtree with it; the items themselves are kept, just untagged.
function deleteCategory(database, name) {
    const drop = tags => tags.filter(tag => !isInCategory(tag, name))
    const pruned = mapItemTags(database, drop)
    return { ...pruned, categories: drop(database.categories) }
}

// Every equipment name in use, for the equipment picker.
function allEquipment(database) {
    return normalizeNames(Object.values(database.exercises).map(exercise => exercise.equipment))
}

// Every muscle named on any exercise, for the muscle picker.
function allMuscles(database) {
    return normalizeNames(Object.values(database.exercises).flatMap(exercise => exercise.muscles))
}

/*
 * Documents written before programs existed carry a flat `routines` map. Each
 * routine becomes a session of the same id -- so log entries that referenced it
 * still resolve -- gathered under one program, which the user then splits up.
 */
const IMPORTED_PROGRAM_ID = "imported"

function migrateRoutines(parsed) {
    if (!parsed?.routines || typeof parsed.routines !== "object") return null
    const sessions = Object.entries(parsed.routines).map(([id, routine]) => ({ ...normalizeSession(routine), id }))
    if (sessions.length === 0) return null
    return normalizeProgram({ id: IMPORTED_PROGRAM_ID, name: "Imported", sessions })
}

/*
 * The Database note is a JSON code note (never touched by the text editor), so
 * its content is raw JSON. Unparseable content becomes an empty database rather
 * than throwing in the widget's render path.
 */
function parseDatabase(content) {
    let parsed = null
    try {
        parsed = content ? JSON.parse(String(content).trim()) : null
    } catch {
        parsed = null
    }
    const exercises = {}
    if (parsed?.exercises && typeof parsed.exercises === "object") {
        for (const [id, exercise] of Object.entries(parsed.exercises)) exercises[id] = { ...normalizeExercise(exercise), id }
    }
    const programs = {}
    if (parsed?.programs && typeof parsed.programs === "object") {
        for (const [id, program] of Object.entries(parsed.programs)) programs[id] = { ...normalizeProgram(program), id }
    }
    const migrated = migrateRoutines(parsed)
    if (migrated) {
        const existing = programs[migrated.id]
        programs[migrated.id] = existing
            ? { ...existing, sessions: [...existing.sessions, ...migrated.sessions] }
            : migrated
    }
    const log = {}
    if (parsed?.log && typeof parsed.log === "object") {
        for (const [date, workouts] of Object.entries(parsed.log)) {
            if (Array.isArray(workouts)) log[date] = workouts.map(normalizeWorkout)
        }
    }
    return { categories: normalizeTags(parsed?.categories), exercises, programs, log }
}

function serializeDatabase(database) {
    return JSON.stringify(database, null, 4)
}

// Volume is weight moved: it only means anything for weight-and-reps exercises.
function setVolume(set, exercise) {
    return measurementOf(exercise).key === "weight" ? set.reps * set.weight : 0
}

// Epley: the load a set of `reps` at `weight` projects to for a single rep.
function estimatedOneRepMax(set) {
    if (!set.reps || !set.weight) return 0
    return set.weight * (1 + set.reps / 30)
}

// What one workout adds up to, across whichever measurements it happens to mix.
function workoutTotals(workout, exercises) {
    const totals = { sets: 0, volume: 0, reps: 0, duration: 0, distance: 0 }
    for (const entry of workout.entries) {
        const exercise = exercises[entry.exerciseId]
        for (const set of entry.sets) {
            totals.sets += 1
            totals.reps += set.reps
            totals.duration += set.duration
            totals.distance += set.distance
            if (exercise) totals.volume += setVolume(set, exercise)
        }
    }
    return totals
}

function allWorkouts(database) {
    return Object.entries(database.log).flatMap(([date, workouts]) => workouts.map(workout => ({ date, workout })))
}

// Every set ever recorded for one exercise, newest date first.
function exerciseHistory(database, exerciseId) {
    return allWorkouts(database)
        .flatMap(({ date, workout }) => workout.entries
            .filter(entry => entry.exerciseId === exerciseId)
            .map(entry => ({ date, workoutId: workout.id, workoutName: workout.name, sets: entry.sets, comment: entry.comment })))
        .sort((a, b) => b.date.localeCompare(a.date))
}

/*
 * Personal bests for one exercise. Every field is reported regardless of the
 * exercise's measurement -- a set carries all of them and the caller shows the
 * ones its measurement cares about -- and a never-performed exercise reports
 * zeroes with a null `lastPerformed` rather than nothing at all.
 */
function exerciseStats(database, exerciseId) {
    const history = exerciseHistory(database, exerciseId)
    const exercise = database.exercises[exerciseId]
    const stats = {
        workouts: history.length,
        lastPerformed: history[0]?.date || null,
        sets: 0,
        totalVolume: 0,
        bestWeight: 0,
        bestReps: 0,
        bestOneRepMax: 0,
        bestDuration: 0,
        bestDistance: 0
    }
    for (const record of history) {
        for (const set of record.sets) {
            stats.sets += 1
            if (exercise) stats.totalVolume += setVolume(set, exercise)
            stats.bestWeight = Math.max(stats.bestWeight, set.weight)
            stats.bestReps = Math.max(stats.bestReps, set.reps)
            stats.bestOneRepMax = Math.max(stats.bestOneRepMax, estimatedOneRepMax(set))
            stats.bestDuration = Math.max(stats.bestDuration, set.duration)
            stats.bestDistance = Math.max(stats.bestDistance, set.distance)
        }
    }
    return stats
}

/*
 * A fresh workout laid out from a session: one entry per session entry, with
 * that entry's target sets pre-created and pre-filled with its targets, so
 * logging is a matter of correcting what actually happened. The program's name
 * prefixes the workout's when there is one, so the log reads "Push/Pull - Legs".
 */
function workoutFromSession(session, startedAt = new Date().toISOString(), program = null) {
    return normalizeWorkout({
        name: program?.name ? `${program.name} - ${session.name}` : session.name,
        sessionId: session.id,
        startedAt,
        entries: session.entries.map(entry => ({
            exerciseId: entry.exerciseId,
            comment: entry.comment,
            sets: Array.from({ length: Math.round(entry.sets) }, () => ({
                reps: entry.reps,
                weight: entry.weight,
                duration: entry.duration,
                distance: entry.distance
            }))
        }))
    })
}

function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10)
}

function shiftDateKey(dateKey, deltaDays) {
    const date = new Date(`${dateKey}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + deltaDays)
    return date.toISOString().slice(0, 10)
}

// The Monday on or before `dateKey`, so weeks group the way a training week does.
function weekStartKey(dateKey) {
    const date = new Date(`${dateKey}T00:00:00Z`)
    const weekday = (date.getUTCDay() + 6) % 7
    return shiftDateKey(dateKey, -weekday)
}

// Sessions per week, newest week first, for the streak/target readout.
function weeklySummary(database, exercises, weeks, today = todayKey()) {
    const start = weekStartKey(today)
    return Array.from({ length: weeks }, (_, index) => {
        const weekStart = shiftDateKey(start, -7 * index)
        const weekEnd = shiftDateKey(weekStart, 6)
        const workouts = allWorkouts(database).filter(({ date }) => date >= weekStart && date <= weekEnd)
        const totals = { workouts: workouts.length, sets: 0, volume: 0, duration: 0, distance: 0 }
        for (const { workout } of workouts) {
            const workoutTotal = workoutTotals(workout, exercises)
            totals.sets += workoutTotal.sets
            totals.volume += workoutTotal.volume
            totals.duration += workoutTotal.duration
            totals.distance += workoutTotal.distance
        }
        return { weekStart, weekEnd, ...totals }
    })
}

function exportDatabase(database) {
    return serializeDatabase(database)
}

/*
 * Import accepts the same document shape serializeDatabase writes, including
 * the pre-programs shape, which parseDatabase migrates on the way in. Ids are
 * preserved rather than regenerated, since sessions and logged workouts
 * reference exercises by id within the same document. Throws on anything that
 * isn't recognisably a database so the caller can report it rather than
 * silently wiping existing data.
 */
function importDatabase(text) {
    let parsed
    try {
        parsed = JSON.parse(String(text).trim())
    } catch {
        throw new Error("Not valid JSON.")
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object with exercises/programs/log.")
    }
    return parseDatabase(JSON.stringify(parsed))
}

module.exports = {
    MEASUREMENTS,
    SET_FIELDS,
    newId,
    measurementOf,
    measurementFields,
    CATEGORY_SEPARATOR,
    normalizeCategoryName,
    normalizeTags,
    categoryDepth,
    categoryLeaf,
    categoryAncestors,
    isInCategory,
    normalizeExercise,
    normalizeSession,
    normalizeSessionEntry,
    normalizeProgram,
    normalizeSet,
    normalizeWorkoutEntry,
    normalizeWorkout,
    allCategories,
    categoryUsage,
    addCategory,
    renameCategory,
    deleteCategory,
    allEquipment,
    allMuscles,
    parseDatabase,
    serializeDatabase,
    setVolume,
    estimatedOneRepMax,
    workoutTotals,
    allWorkouts,
    allSessions,
    findSession,
    exerciseHistory,
    exerciseStats,
    workoutFromSession,
    todayKey,
    shiftDateKey,
    weekStartKey,
    weeklySummary,
    exportDatabase,
    importDatabase
}
