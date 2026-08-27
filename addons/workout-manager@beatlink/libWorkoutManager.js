/*
 * Workout Manager data model. Pure functions over the JSON document stored in
 * the addon's persisted Database note:
 *   {
 *     categories: [ "Push", "Push/Chest", ... ],
 *     exercises: { [id]: { id, name, measurement, equipment, muscles: [...], comment, tags: [...] } },
 *     programs: { [id]: { id, name, comment, sessions: [ { id, name, comment, tags: [...], entries: [{ id, exerciseId, sets, reps, weight, duration, distance, rest, comment, progression }] } ] } },
 *     log: { [date]: [ { id, name, sessionId, startedAt, finishedAt, comment, entries: [ { id, exerciseId, sessionEntryId, target, comment, sets: [ { id, reps, weight, duration, distance, rpe } ] } ] } ] }
 *   }
 * A program is an ordered group of sessions -- Program -> Session -> Exercise.
 * A session is a plan; a log entry is one workout actually performed, pointing
 * back at the session it was started from via `sessionId` (empty when ad-hoc).
 * Session ids are unique across every program, so a workout needs no program id.
 * Finishing a workout is what feeds its result back into the plan: each entry's
 * progression rewrites the session entry's own targets for next time.
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
 * Progressive overload, following the three progressions Liftosaur builds in
 * (https://www.liftosaur.com/doc/liftoscript): linear adds weight after N
 * successful workouts and optionally takes it back off after N failed ones,
 * double walks the reps up a range before adding weight and resetting them, and
 * sum adds weight once the reps across all sets clear a threshold. A progression
 * belongs to one session entry, keeps its own attempt counters between
 * workouts, and rewrites that entry's targets when a workout is finished.
 * All three move weight, so they only apply to Weight & Reps exercises.
 */
const PROGRESSIONS = [
    { key: "none", label: "None", fields: [] },
    { key: "linear", label: "Linear", fields: ["increment", "successes", "decrement", "failures"] },
    { key: "double", label: "Double", fields: ["increment", "minReps", "maxReps"] },
    { key: "sum", label: "Sum of Reps", fields: ["repsThreshold", "increment"] }
]

// How each progression parameter is labelled and edited; `percentKey` names the
// companion flag that switches a weight step from absolute to a percentage.
const PROGRESSION_FIELDS = {
    increment: { label: "Increase by", step: 0.5, percentKey: "incrementPercent" },
    successes: { label: "After successes", step: 1 },
    decrement: { label: "Decrease by", step: 0.5, percentKey: "decrementPercent" },
    failures: { label: "After failures", step: 1 },
    minReps: { label: "Min reps", step: 1 },
    maxReps: { label: "Max reps", step: 1 },
    repsThreshold: { label: "Total reps", step: 1 }
}

// Seeded into fields still left at zero when a type is picked, so the form opens
// on numbers that describe a workable progression rather than on nothing.
const PROGRESSION_DEFAULTS = {
    linear: { increment: 2.5 },
    double: { increment: 2.5, minReps: 6, maxReps: 10 },
    sum: { repsThreshold: 30, increment: 2.5 }
}

function progressionOf(progression) {
    const key = progression?.type
    return PROGRESSIONS.find(item => item.key === key) || PROGRESSIONS[0]
}

/*
 * Every field is kept whatever the type, exactly as a set record keeps every
 * measurement field: the ones this type does not read simply stay at their
 * default, so switching type and back does not lose what was typed.
 */
function normalizeProgression(progression) {
    return {
        type: progressionOf(progression).key,
        increment: nonNegativeNumber(progression?.increment),
        incrementPercent: progression?.incrementPercent === true,
        successes: positiveNumber(progression?.successes, 1),
        successCounter: nonNegativeNumber(progression?.successCounter),
        decrement: nonNegativeNumber(progression?.decrement),
        decrementPercent: progression?.decrementPercent === true,
        failures: positiveNumber(progression?.failures, 1),
        failureCounter: nonNegativeNumber(progression?.failureCounter),
        minReps: nonNegativeNumber(progression?.minReps),
        maxReps: nonNegativeNumber(progression?.maxReps),
        repsThreshold: nonNegativeNumber(progression?.repsThreshold)
    }
}

// All three progressions move weight, so none of them means anything for an
// exercise measured any other way.
function progressable(exercise) {
    return !!exercise && measurementOf(exercise).key === "weight"
}

function progressionApplies(entry, exercise) {
    return entry.progression.type !== "none" && progressable(exercise)
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
        comment: trimmedString(entry?.comment),
        progression: normalizeProgression(entry?.progression)
    }
}

// The numbers a session entry prescribes, in the shape a workout snapshots.
function entryTarget(entry) {
    return {
        sets: entry.sets,
        reps: entry.reps,
        weight: entry.weight,
        duration: entry.duration,
        distance: entry.distance
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

/*
 * What a workout entry was prescribed. Snapshotted when the workout is started
 * so progression judges it against the plan as it stood then, not against a
 * plan a previous workout has since moved. Empty for an ad-hoc entry.
 */
function normalizeTarget(target) {
    return {
        sets: nonNegativeNumber(target?.sets),
        reps: nonNegativeNumber(target?.reps),
        weight: nonNegativeNumber(target?.weight),
        duration: nonNegativeNumber(target?.duration),
        distance: nonNegativeNumber(target?.distance)
    }
}

function normalizeWorkoutEntry(entry) {
    return {
        id: typeof entry?.id === "string" && entry.id ? entry.id : newId(),
        exerciseId: typeof entry?.exerciseId === "string" ? entry.exerciseId : "",
        // The session entry this came from, so progression still finds it after
        // the session has been reordered or has gained the same exercise twice.
        sessionEntryId: typeof entry?.sessionEntryId === "string" ? entry.sessionEntryId : "",
        target: normalizeTarget(entry?.target),
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
        // Set once progression has been applied; empty means still open.
        finishedAt: typeof workout?.finishedAt === "string" ? workout.finishedAt : "",
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
            sessionEntryId: entry.id,
            target: entryTarget(entry),
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

/*
 * What one session entry's logged sets achieved, reduced to the numbers a
 * progression asks about. A plan prescribes one target for all of its sets, so
 * the weakest set decides whether the target was met, and the weight is the
 * last one actually lifted -- falling back to the planned weight when none was
 * recorded, as Liftosaur does for an unfilled weight.
 */
function setsPerformance(target, sets) {
    const reps = sets.map(set => set.reps)
    const lifted = sets.map(set => set.weight).filter(weight => weight > 0).at(-1)
    return {
        sets: sets.length,
        minReps: reps.length > 0 ? Math.min(...reps) : 0,
        totalReps: reps.reduce((total, value) => total + value, 0),
        weight: lifted || target.weight
    }
}

// The plan was met when every prescribed set was performed at or above its target reps.
function targetMet(target, performance) {
    return target.sets > 0 && target.reps > 0
        && performance.sets >= target.sets
        && performance.minReps >= target.reps
}

// Two decimals, so a percentage step cannot leave float noise in the plan.
function stepWeight(weight, step, isPercent, direction) {
    if (step <= 0) return weight
    const next = isPercent ? weight * (1 + direction * step / 100) : weight + direction * step
    return Math.max(0, Math.round(next * 100) / 100)
}

/*
 * Runs one progression over what a workout recorded against the target it was
 * given, returning the entry's next targets, the progression's next counters,
 * and what happened. Nothing is mutated; the caller writes the result back.
 * The branches follow Liftosaur's own generated scripts, including that an
 * increase is applied to the weight actually lifted while a decrease comes off
 * the weight that was planned, and that a missed attempt leaves the success
 * counter standing rather than resetting it.
 */
function evaluateProgression(progression, target, sets) {
    const performance = setsPerformance(target, sets)
    const met = targetMet(target, performance)
    const hold = { progression, changes: {}, outcome: "hold", counter: "" }
    const increase = () => stepWeight(performance.weight, progression.increment, progression.incrementPercent, 1)

    if (progression.type === "linear") {
        if (met) {
            const successCounter = progression.successCounter + 1
            if (successCounter < progression.successes) {
                return {
                    ...hold,
                    progression: { ...progression, successCounter },
                    counter: `${successCounter}/${progression.successes} successes`
                }
            }
            return {
                progression: { ...progression, successCounter: 0, failureCounter: 0 },
                changes: { weight: increase() },
                outcome: "increase",
                counter: ""
            }
        }
        if (progression.decrement <= 0) return hold
        const failureCounter = progression.failureCounter + 1
        if (failureCounter < progression.failures) {
            return {
                ...hold,
                progression: { ...progression, failureCounter },
                counter: `${failureCounter}/${progression.failures} failures`
            }
        }
        return {
            progression: { ...progression, successCounter: 0, failureCounter: 0 },
            changes: { weight: stepWeight(target.weight, progression.decrement, progression.decrementPercent, -1) },
            outcome: "decrease",
            counter: ""
        }
    }

    if (progression.type === "double") {
        const maxReps = Math.max(progression.minReps, progression.maxReps)
        if (!met || maxReps <= 0) return hold
        // The top of the range is where reps reset and the weight moves instead.
        if (performance.minReps >= maxReps) {
            return {
                progression,
                changes: { reps: progression.minReps, weight: increase() },
                outcome: "increase",
                counter: ""
            }
        }
        return { progression, changes: { reps: Math.min(performance.minReps + 1, maxReps) }, outcome: "reps", counter: "" }
    }

    // Sum asks only about the total reps, never about whether each set met its target.
    if (progression.type === "sum") {
        if (progression.repsThreshold <= 0) return hold
        if (performance.totalReps < progression.repsThreshold) {
            return { ...hold, counter: `${performance.totalReps}/${progression.repsThreshold} reps` }
        }
        return { progression, changes: { weight: increase() }, outcome: "increase", counter: "" }
    }

    return hold
}

/*
 * Finishing a workout is what applies progression. Every entry that came from a
 * session entry carrying one is judged against the targets snapshotted when the
 * workout started, and that entry's targets and counters are rewritten in the
 * session. The workout is stamped finished, which is what stops a second press
 * progressing the same session twice. Finishing does not undo: a workout
 * finished by mistake leaves the session's new targets to be corrected by hand.
 */
function finishWorkout(database, date, workoutId, finishedAt = new Date().toISOString()) {
    const workouts = database.log[date] || []
    const workout = workouts.find(item => item.id === workoutId)
    if (!workout || workout.finishedAt) return { database, reports: [] }

    const log = { ...database.log, [date]: workouts.map(item => item.id === workoutId ? { ...item, finishedAt } : item) }
    const found = findSession(database, workout.sessionId)
    if (!found) return { database: { ...database, log }, reports: [] }

    const reports = []
    const entries = found.session.entries.map(entry => {
        const logged = workout.entries.find(item => item.sessionEntryId
            ? item.sessionEntryId === entry.id
            : item.exerciseId === entry.exerciseId)
        const exercise = database.exercises[entry.exerciseId]
        if (!logged || !progressionApplies(entry, exercise)) return entry
        // A workout logged before targets were snapshotted has none, so it is
        // judged against the entry's targets as they stand now.
        const target = logged.target.sets > 0 ? logged.target : entryTarget(entry)
        const result = evaluateProgression(entry.progression, target, logged.sets)
        reports.push({
            // Two entries of a session can share an exercise, so the entry is
            // what identifies a line of the report.
            entryId: entry.id,
            exerciseId: entry.exerciseId,
            outcome: result.outcome,
            counter: result.counter,
            from: { reps: target.reps, weight: target.weight },
            to: { reps: result.changes.reps ?? target.reps, weight: result.changes.weight ?? target.weight }
        })
        return { ...entry, ...result.changes, progression: result.progression }
    })

    const session = { ...found.session, entries }
    const program = { ...found.program, sessions: found.program.sessions.map(item => item.id === session.id ? session : item) }
    return {
        database: { ...database, programs: { ...database.programs, [program.id]: program }, log },
        reports
    }
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
    PROGRESSIONS,
    PROGRESSION_FIELDS,
    PROGRESSION_DEFAULTS,
    newId,
    measurementOf,
    measurementFields,
    progressionOf,
    normalizeProgression,
    progressable,
    progressionApplies,
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
    entryTarget,
    evaluateProgression,
    finishWorkout,
    todayKey,
    shiftDateKey,
    weekStartKey,
    weeklySummary,
    exportDatabase,
    importDatabase
}
