import { useState, useEffect, useRef, useCallback, useMemo, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

const {
    MEASUREMENTS,
    newId,
    measurementOf,
    measurementFields,
    normalizeTags,
    categoryDepth,
    categoryLeaf,
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
    workoutTotals,
    allSessions,
    findSession,
    exerciseHistory,
    exerciseStats,
    workoutFromSession,
    todayKey,
    shiftDateKey,
    weeklySummary,
    exportDatabase,
    importDatabase
} = require("libWorkoutManager.js")
const { searchExercises: searchWger } = require("libWger.js")
const { convertLiftosaurExport } = require("libLiftosaur.js")

const UNTAGGED = "Uncategorised"

// Trailing zeroes read as false precision on a weight or a distance, so whole
// numbers print whole and everything else keeps one decimal.
function formatNumber(value) {
    if (!Number.isFinite(value)) return "0"
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

// ---------------------------------------------------------------------------
// Free-text field with a dropdown of values already in use, shared by the
// category, equipment and muscle pickers. Clicking or focusing it offers the
// full list -- a native <datalist> only opens once the browser feels like it --
// and typing narrows it, while anything not on the list can still just be typed.
// ---------------------------------------------------------------------------
function SuggestInput({ value, suggestions, placeholder, className, onChange, onPick, onCommit }) {
    const [open, setOpen] = useState(false)

    const matches = useMemo(() => {
        const needle = value.trim().toLowerCase()
        return needle ? suggestions.filter(s => s.toLowerCase().includes(needle)) : suggestions
    }, [suggestions, value])

    const choose = useCallback(suggestion => {
        (onPick ?? onChange)(suggestion)
        setOpen(false)
    }, [onPick, onChange])

    return (
        <div className={className ? `workout-manager-suggest ${className}` : "workout-manager-suggest"}>
            <input
                type="text"
                placeholder={placeholder}
                value={value}
                onInput={e => { onChange(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                // Blur closes on a delay so a click on a suggestion still lands.
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={e => {
                    if (e.key === "Enter" && onCommit) { e.preventDefault(); onCommit(); setOpen(false) }
                    if (e.key === "Escape") setOpen(false)
                }}
            />
            {open && matches.length > 0 && (
                <ul className="workout-manager-suggestions">
                    {matches.map(suggestion => (
                        <li key={suggestion}>
                            <button onClick={() => choose(suggestion)}>{suggestion}</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Chip list backed by a suggesting free-text field, used for an exercise's
// categories and for the muscles it works. The draft lives in the parent form so
// saving can commit a value still sitting in the field.
// ---------------------------------------------------------------------------
function ChipEditor({ label, placeholder, values, draft, suggestions, onChange, onDraftChange }) {
    const addDraft = useCallback(() => {
        const trimmed = draft.trim()
        if (!trimmed) return
        onChange([...values, trimmed])
        onDraftChange("")
    }, [draft, values, onChange, onDraftChange])

    const unused = useMemo(() => suggestions.filter(item => !values.includes(item)), [suggestions, values])

    return (
        <div className="workout-manager-field">
            <span>{label}</span>
            <div className="workout-manager-chips">
                {values.map(value => (
                    <span className="workout-manager-chip" key={value}>
                        {value}
                        <button
                            className="workout-manager-chip-remove bx bx-x"
                            title={`Remove ${value}`}
                            onClick={() => onChange(values.filter(item => item !== value))}
                        />
                    </span>
                ))}
                {values.length === 0 && <span className="workout-manager-hint">None.</span>}
            </div>
            <div className="workout-manager-chip-add">
                <SuggestInput
                    className="workout-manager-suggest-grow"
                    placeholder={placeholder}
                    value={draft}
                    suggestions={unused}
                    onChange={onDraftChange}
                    onPick={value => { onChange([...values, value]); onDraftChange("") }}
                    onCommit={addDraft}
                />
                <Button text="Add" onClick={addDraft} disabled={!draft.trim()} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Exercise picker, shared by session entries and the log: one <optgroup> per
// category (an exercise in several categories is offered under each),
// uncategorised exercises last.
// ---------------------------------------------------------------------------
function ExerciseSelect({ exercises, categories, value, placeholder, onChange }) {
    const groups = useMemo(() => {
        const available = Object.values(exercises).sort((a, b) => a.name.localeCompare(b.name))
        const byCategory = categories
            .map(tag => [tag, available.filter(exercise => exercise.tags.includes(tag))])
            .filter(([, members]) => members.length > 0)
        const untagged = available.filter(exercise => exercise.tags.length === 0)
        if (untagged.length > 0) byCategory.push([UNTAGGED, untagged])
        return byCategory
    }, [exercises, categories])

    return (
        <select value={value} onChange={e => onChange(e.target.value)}>
            <option value="">{groups.length === 0 ? "No exercises yet" : placeholder}</option>
            {groups.map(([tag, members]) => (
                <optgroup label={tag} key={tag}>
                    {members.map(exercise => <option value={exercise.id} key={exercise.id}>{exercise.name}</option>)}
                </optgroup>
            ))}
        </select>
    )
}

// A number cell that leaves the field blank at 0, so an untouched set reads as
// empty rather than as a wall of zeroes.
function NumberInput({ value, step, placeholder, onChange }) {
    return (
        <input
            type="number"
            min="0"
            step={step ?? "1"}
            placeholder={placeholder}
            value={value || ""}
            onInput={e => onChange(parseFloat(e.target.value) || 0)}
        />
    )
}

// ---------------------------------------------------------------------------
// Exercises tab
// ---------------------------------------------------------------------------
function ExerciseForm({ initial, categories, equipmentSuggestions, muscleSuggestions, onSave, onCancel }) {
    const [exercise, setExercise] = useState(() => normalizeExercise(initial))
    const [tagDraft, setTagDraft] = useState("")
    const [muscleDraft, setMuscleDraft] = useState("")
    const [query, setQuery] = useState("")
    const [results, setResults] = useState(null)
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState(null)

    const runSearch = useCallback(async () => {
        const trimmed = query.trim()
        if (!trimmed) return
        setSearching(true)
        setError(null)
        try {
            setResults(await searchWger(trimmed))
        } catch (e) {
            setResults([])
            setError(String(e && e.message ? e.message : e))
        } finally {
            setSearching(false)
        }
    }, [query])

    // A wger hit only prefills the form; nothing is saved until the user does.
    const applyResult = useCallback(result => {
        setExercise(current => normalizeExercise({
            ...current,
            name: result.name,
            measurement: result.measurement,
            equipment: result.equipment,
            muscles: result.muscles,
            tags: result.category ? normalizeTags([...current.tags, result.category]) : current.tags
        }))
        setResults(null)
        setQuery("")
    }, [])

    const save = useCallback(() => {
        const withDrafts = {
            ...exercise,
            tags: tagDraft.trim() ? [...exercise.tags, tagDraft.trim()] : exercise.tags,
            muscles: muscleDraft.trim() ? [...exercise.muscles, muscleDraft.trim()] : exercise.muscles
        }
        const normalized = normalizeExercise(withDrafts)
        if (!normalized.name.trim()) {
            api.showError("An exercise needs a name.")
            return
        }
        onSave(normalized)
    }, [exercise, tagDraft, muscleDraft, onSave])

    return (
        <div className="workout-manager-form">
            <div className="workout-manager-lookup">
                <input
                    type="text"
                    placeholder="Search the wger exercise database..."
                    value={query}
                    onInput={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") runSearch() }}
                />
                <Button icon="bx-search" text={searching ? "Searching..." : "Search"} onClick={runSearch} disabled={searching || !query.trim()} />
            </div>
            {error && <p className="workout-manager-error">{error}</p>}
            {results && results.length === 0 && !searching && <p className="workout-manager-hint">No matches.</p>}
            {results && results.length > 0 && (
                <ul className="workout-manager-results">
                    {results.map(result => (
                        <li key={result.wgerId}>
                            <button onClick={() => applyResult(result)}>
                                <strong>{result.name}</strong>
                                <span className="workout-manager-hint">
                                    {[result.category, result.equipment].filter(Boolean).join(" · ") || "no equipment"}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <label className="workout-manager-field">
                <span>Name</span>
                <input type="text" value={exercise.name} onInput={e => setExercise({ ...exercise, name: e.target.value })} />
            </label>
            <label className="workout-manager-field">
                <span>Measured As</span>
                <select value={exercise.measurement} onChange={e => setExercise({ ...exercise, measurement: e.target.value })}>
                    {MEASUREMENTS.map(m => <option value={m.key} key={m.key}>{m.label}</option>)}
                </select>
            </label>
            <div className="workout-manager-field">
                <span>Equipment</span>
                <SuggestInput
                    placeholder="Barbell, dumbbell, none..."
                    value={exercise.equipment}
                    suggestions={equipmentSuggestions}
                    onChange={value => setExercise({ ...exercise, equipment: value })}
                />
            </div>
            <ChipEditor
                label="Muscles"
                placeholder="Add a muscle..."
                values={exercise.muscles}
                draft={muscleDraft}
                suggestions={muscleSuggestions}
                onChange={muscles => setExercise({ ...exercise, muscles })}
                onDraftChange={setMuscleDraft}
            />
            <ChipEditor
                label="Categories"
                placeholder="Add a category..."
                values={exercise.tags}
                draft={tagDraft}
                suggestions={categories}
                onChange={tags => setExercise({ ...exercise, tags })}
                onDraftChange={setTagDraft}
            />
            <label className="workout-manager-field">
                <span>Notes</span>
                <textarea rows="2" value={exercise.comment} onInput={e => setExercise({ ...exercise, comment: e.target.value })} />
            </label>
            <div className="workout-manager-form-actions">
                <Button icon="bx-check" text="Save" onClick={save} />
                <Button icon="bx-x" text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

function ExercisesTab({ database, categories, onSave, onDelete }) {
    const [editing, setEditing] = useState(null)
    const [filter, setFilter] = useState("")
    const [search, setSearch] = useState("")

    const equipmentSuggestions = useMemo(() => allEquipment(database), [database])
    const muscleSuggestions = useMemo(() => allMuscles(database), [database])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return Object.values(database.exercises)
            .filter(exercise => !filter || exercise.tags.some(tag => isInCategory(tag, filter)))
            .filter(exercise => !needle || exercise.name.toLowerCase().includes(needle))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [database.exercises, filter, search])

    if (editing) {
        return (
            <ExerciseForm
                initial={editing}
                categories={categories}
                equipmentSuggestions={equipmentSuggestions}
                muscleSuggestions={muscleSuggestions}
                onSave={exercise => { onSave(exercise); setEditing(null) }}
                onCancel={() => setEditing(null)}
            />
        )
    }

    return (
        <div>
            <div className="workout-manager-toolbar">
                <Button icon="bx-plus" text="Add Exercise" onClick={() => setEditing({})} />
                <input type="text" placeholder="Search..." value={search} onInput={e => setSearch(e.target.value)} />
                <select value={filter} onChange={e => setFilter(e.target.value)}>
                    <option value="">All categories</option>
                    {categories.map(name => (
                        <option value={name} key={name}>{`${" ".repeat(categoryDepth(name) * 4)}${categoryLeaf(name)}`}</option>
                    ))}
                </select>
            </div>
            <table className="workout-manager-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Measured As</th>
                        <th>Equipment</th>
                        <th>Muscles</th>
                        <th>Categories</th>
                        <th>Last Done</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {visible.map(exercise => {
                        const stats = exerciseStats(database, exercise.id)
                        return (
                            <tr key={exercise.id}>
                                <td title={exercise.comment}>{exercise.name}</td>
                                <td>{measurementOf(exercise).label}</td>
                                <td>{exercise.equipment || "—"}</td>
                                <td>{exercise.muscles.join(", ") || "—"}</td>
                                <td>{exercise.tags.join(", ") || "—"}</td>
                                <td>{stats.lastPerformed || "—"}</td>
                                <td className="workout-manager-row-actions">
                                    <Button icon="bx-edit" title="Edit" onClick={() => setEditing(exercise)} />
                                    <Button icon="bx-trash" title="Delete" onClick={() => onDelete(exercise)} />
                                </td>
                            </tr>
                        )
                    })}
                    {visible.length === 0 && (
                        <tr><td colSpan="7" className="workout-manager-hint">No exercises.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Programs tab
// ---------------------------------------------------------------------------
function SessionForm({ initial, exercises, categories, units, defaultRest, onSave, onCancel }) {
    const [session, setSession] = useState(() => normalizeSession(initial))
    const [tagDraft, setTagDraft] = useState("")

    const setEntry = useCallback((id, changes) => {
        setSession(current => ({
            ...current,
            entries: current.entries.map(entry => entry.id === id ? { ...entry, ...changes } : entry)
        }))
    }, [])

    const addEntry = useCallback(() => {
        setSession(current => ({
            ...current,
            entries: [...current.entries, normalizeSessionEntry({ id: newId(), rest: defaultRest })]
        }))
    }, [defaultRest])

    // Order is the plan's order, so entries move rather than sort.
    const moveEntry = useCallback((index, delta) => {
        setSession(current => {
            const target = index + delta
            if (target < 0 || target >= current.entries.length) return current
            const entries = [...current.entries]
            const [moved] = entries.splice(index, 1)
            entries.splice(target, 0, moved)
            return { ...current, entries }
        })
    }, [])

    const save = useCallback(() => {
        const withDraft = { ...session, tags: tagDraft.trim() ? [...session.tags, tagDraft.trim()] : session.tags }
        const normalized = normalizeSession(withDraft)
        if (!normalized.name.trim()) {
            api.showError("A session needs a name.")
            return
        }
        onSave({ ...normalized, entries: normalized.entries.filter(entry => entry.exerciseId) })
    }, [session, tagDraft, onSave])

    return (
        <div className="workout-manager-form">
            <label className="workout-manager-field">
                <span>Name</span>
                <input type="text" value={session.name} onInput={e => setSession({ ...session, name: e.target.value })} />
            </label>
            <ChipEditor
                label="Categories"
                placeholder="Add a category..."
                values={session.tags}
                draft={tagDraft}
                suggestions={categories}
                onChange={tags => setSession({ ...session, tags })}
                onDraftChange={setTagDraft}
            />
            <label className="workout-manager-field">
                <span>Notes</span>
                <textarea rows="2" value={session.comment} onInput={e => setSession({ ...session, comment: e.target.value })} />
            </label>

            <table className="workout-manager-table">
                <thead>
                    <tr>
                        <th>Exercise</th>
                        <th>Sets</th>
                        <th>Targets</th>
                        <th>Rest (s)</th>
                        <th>Notes</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {session.entries.map((entry, index) => {
                        const exercise = exercises[entry.exerciseId]
                        return (
                            <tr key={entry.id}>
                                <td>
                                    <ExerciseSelect
                                        exercises={exercises}
                                        categories={categories}
                                        value={entry.exerciseId}
                                        placeholder="Pick an exercise..."
                                        onChange={exerciseId => setEntry(entry.id, { exerciseId })}
                                    />
                                </td>
                                <td><NumberInput value={entry.sets} onChange={sets => setEntry(entry.id, { sets })} /></td>
                                <td className="workout-manager-target-cell">
                                    {exercise
                                        ? measurementFields(exercise).map(field => (
                                            <label key={field.key}>
                                                <NumberInput
                                                    value={entry[field.key]}
                                                    step="0.5"
                                                    onChange={value => setEntry(entry.id, { [field.key]: value })}
                                                />
                                                <span>{field.unit ? units[field.unit] : field.label.toLowerCase()}</span>
                                            </label>
                                        ))
                                        : <span className="workout-manager-hint">—</span>}
                                </td>
                                <td><NumberInput value={entry.rest} step="15" onChange={rest => setEntry(entry.id, { rest })} /></td>
                                <td>
                                    <input type="text" value={entry.comment} onInput={e => setEntry(entry.id, { comment: e.target.value })} />
                                </td>
                                <td className="workout-manager-row-actions">
                                    <Button icon="bx-up-arrow-alt" title="Move up" onClick={() => moveEntry(index, -1)} />
                                    <Button icon="bx-down-arrow-alt" title="Move down" onClick={() => moveEntry(index, 1)} />
                                    <Button
                                        icon="bx-trash"
                                        title="Remove"
                                        onClick={() => setSession(current => ({ ...current, entries: current.entries.filter(e => e.id !== entry.id) }))}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                    {session.entries.length === 0 && (
                        <tr><td colSpan="6" className="workout-manager-hint">No exercises in this session yet.</td></tr>
                    )}
                </tbody>
            </table>
            <div className="workout-manager-form-actions">
                <Button icon="bx-plus" text="Add Exercise" onClick={addEntry} />
                <Button icon="bx-check" text="Save" onClick={save} />
                <Button icon="bx-x" text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

function ProgramsTab({
    database, categories, units, defaultRest,
    onSaveProgram, onDeleteProgram, onSaveSession, onDeleteSession, onMoveSession, onStart
}) {
    const [editing, setEditing] = useState(null)
    const [draft, setDraft] = useState("")
    const [renaming, setRenaming] = useState(null)
    const [renameDraft, setRenameDraft] = useState("")

    const programs = useMemo(
        () => Object.values(database.programs).sort((a, b) => a.name.localeCompare(b.name)),
        [database.programs]
    )

    const create = useCallback(() => {
        if (!draft.trim()) return
        onSaveProgram(normalizeProgram({ name: draft.trim() }))
        setDraft("")
    }, [draft, onSaveProgram])

    // Editing a session needs its program too, since a session is only ever
    // reached through the program that owns it.
    if (editing) {
        return (
            <SessionForm
                initial={editing.session}
                exercises={database.exercises}
                categories={categories}
                units={units}
                defaultRest={defaultRest}
                onSave={session => { onSaveSession(editing.programId, session); setEditing(null) }}
                onCancel={() => setEditing(null)}
            />
        )
    }

    return (
        <div>
            <div className="workout-manager-toolbar">
                <input
                    type="text"
                    placeholder="New program..."
                    value={draft}
                    onInput={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") create() }}
                />
                <Button icon="bx-plus" text="Add Program" onClick={create} disabled={!draft.trim()} />
            </div>
            {programs.length === 0 && <p className="workout-manager-hint">No programs yet.</p>}
            {programs.map(program => (
                <div className="workout-manager-program" key={program.id}>
                    <div className="workout-manager-card-header">
                        {renaming === program.id ? (
                            <input
                                type="text"
                                value={renameDraft}
                                autoFocus
                                onInput={e => setRenameDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") {
                                        onSaveProgram({ ...program, name: renameDraft.trim() || program.name })
                                        setRenaming(null)
                                    }
                                    if (e.key === "Escape") setRenaming(null)
                                }}
                            />
                        ) : <strong>{program.name}</strong>}
                        <span className="workout-manager-hint">{program.sessions.length} session(s)</span>
                        <span className="workout-manager-spacer" />
                        <Button
                            icon="bx-plus"
                            text="Add Session"
                            onClick={() => setEditing({ programId: program.id, session: {} })}
                        />
                        <Button
                            icon="bx-edit"
                            title="Rename program"
                            onClick={() => { setRenaming(program.id); setRenameDraft(program.name) }}
                        />
                        <Button icon="bx-trash" title="Delete program" onClick={() => onDeleteProgram(program)} />
                    </div>
                    {program.comment && <p className="workout-manager-hint">{program.comment}</p>}
                    {program.sessions.length === 0 && (
                        <p className="workout-manager-hint">No sessions in this program yet.</p>
                    )}
                    {program.sessions.map((session, index) => (
                        <div className="workout-manager-card workout-manager-session" key={session.id}>
                            <div className="workout-manager-card-header">
                                <strong>{session.name}</strong>
                                <span className="workout-manager-hint">
                                    {session.entries.length} exercise(s)
                                    {session.tags.length > 0 ? ` · ${session.tags.join(", ")}` : ""}
                                </span>
                                <span className="workout-manager-spacer" />
                                <Button
                                    icon="bx-chevron-up"
                                    title="Move up"
                                    disabled={index === 0}
                                    onClick={() => onMoveSession(program.id, session.id, -1)}
                                />
                                <Button
                                    icon="bx-chevron-down"
                                    title="Move down"
                                    disabled={index === program.sessions.length - 1}
                                    onClick={() => onMoveSession(program.id, session.id, 1)}
                                />
                                <Button icon="bx-play" text="Start Today" onClick={() => onStart(program, session)} />
                                <Button
                                    icon="bx-edit"
                                    title="Edit"
                                    onClick={() => setEditing({ programId: program.id, session })}
                                />
                                <Button
                                    icon="bx-trash"
                                    title="Delete"
                                    onClick={() => onDeleteSession(program.id, session)}
                                />
                            </div>
                            {session.comment && <p className="workout-manager-hint">{session.comment}</p>}
                            <ul className="workout-manager-plan">
                                {session.entries.map(entry => {
                                    const exercise = database.exercises[entry.exerciseId]
                                    if (!exercise) return null
                                    const targets = measurementFields(exercise)
                                        .filter(field => entry[field.key] > 0)
                                        .map(field => `${formatNumber(entry[field.key])} ${field.unit ? units[field.unit] : field.label.toLowerCase()}`)
                                        .join(" × ")
                                    return (
                                        <li key={entry.id}>
                                            {`${formatNumber(entry.sets)} × ${exercise.name}`}
                                            {targets && ` — ${targets}`}
                                            {entry.rest > 0 && ` · ${formatNumber(entry.rest)}s rest`}
                                            {entry.comment && ` · ${entry.comment}`}
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Log tab
// ---------------------------------------------------------------------------
function WorkoutEntry({ entry, exercises, units, onChange, onRemove }) {
    const exercise = exercises[entry.exerciseId]
    const fields = exercise ? measurementFields(exercise) : []

    const setSet = useCallback((setId, changes) => {
        onChange({ ...entry, sets: entry.sets.map(set => set.id === setId ? { ...set, ...changes } : set) })
    }, [entry, onChange])

    // A new set starts from the last one, since sets of the same exercise
    // usually repeat the previous load.
    const addSet = useCallback(() => {
        const last = entry.sets.at(-1)
        onChange({ ...entry, sets: [...entry.sets, normalizeSet({ ...last, id: newId() })] })
    }, [entry, onChange])

    return (
        <div className="workout-manager-entry">
            <div className="workout-manager-entry-header">
                <strong>{exercise ? exercise.name : "Deleted exercise"}</strong>
                {exercise && <span className="workout-manager-hint">{measurementOf(exercise).label}</span>}
                <span className="workout-manager-spacer" />
                <input
                    type="text"
                    className="workout-manager-entry-comment"
                    placeholder="Notes..."
                    value={entry.comment}
                    onInput={e => onChange({ ...entry, comment: e.target.value })}
                />
                <Button icon="bx-trash" title="Remove exercise" onClick={onRemove} />
            </div>
            <table className="workout-manager-table workout-manager-sets">
                <thead>
                    <tr>
                        <th>Set</th>
                        {fields.map(field => <th key={field.key}>{field.unit ? `${field.label} (${units[field.unit]})` : field.label}</th>)}
                        <th>RPE</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {entry.sets.map((set, index) => (
                        <tr key={set.id}>
                            <td>{index + 1}</td>
                            {fields.map(field => (
                                <td key={field.key}>
                                    <NumberInput value={set[field.key]} step="0.5" onChange={value => setSet(set.id, { [field.key]: value })} />
                                </td>
                            ))}
                            <td><NumberInput value={set.rpe} step="0.5" onChange={rpe => setSet(set.id, { rpe })} /></td>
                            <td className="workout-manager-row-actions">
                                <Button
                                    icon="bx-trash"
                                    title="Remove set"
                                    onClick={() => onChange({ ...entry, sets: entry.sets.filter(s => s.id !== set.id) })}
                                />
                            </td>
                        </tr>
                    ))}
                    {entry.sets.length === 0 && (
                        <tr><td colSpan={fields.length + 3} className="workout-manager-hint">No sets recorded.</td></tr>
                    )}
                </tbody>
            </table>
            <Button icon="bx-plus" text="Add Set" onClick={addSet} />
        </div>
    )
}

function Workout({ workout, exercises, categories, units, onChange, onRemove }) {
    const [adding, setAdding] = useState("")
    const totals = useMemo(() => workoutTotals(workout, exercises), [workout, exercises])

    const addExercise = useCallback(exerciseId => {
        setAdding("")
        if (!exerciseId) return
        onChange({
            ...workout,
            entries: [...workout.entries, normalizeWorkoutEntry({ id: newId(), exerciseId, sets: [{}] })]
        })
    }, [workout, onChange])

    const setEntry = useCallback(updated => {
        onChange({ ...workout, entries: workout.entries.map(entry => entry.id === updated.id ? updated : entry) })
    }, [workout, onChange])

    return (
        <div className="workout-manager-card">
            <div className="workout-manager-card-header">
                <input
                    type="text"
                    className="workout-manager-workout-name"
                    value={workout.name}
                    onInput={e => onChange({ ...workout, name: e.target.value })}
                />
                <span className="workout-manager-hint">
                    {`${totals.sets} set(s)`}
                    {totals.volume > 0 && ` · ${formatNumber(totals.volume)} ${units.weight} volume`}
                    {totals.duration > 0 && ` · ${formatNumber(totals.duration)} min`}
                    {totals.distance > 0 && ` · ${formatNumber(totals.distance)} ${units.distance}`}
                </span>
                <span className="workout-manager-spacer" />
                <Button icon="bx-trash" title="Delete workout" onClick={onRemove} />
            </div>
            <input
                type="text"
                className="workout-manager-workout-comment"
                placeholder="How did it go?"
                value={workout.comment}
                onInput={e => onChange({ ...workout, comment: e.target.value })}
            />
            {workout.entries.map(entry => (
                <WorkoutEntry
                    key={entry.id}
                    entry={entry}
                    exercises={exercises}
                    units={units}
                    onChange={setEntry}
                    onRemove={() => onChange({ ...workout, entries: workout.entries.filter(e => e.id !== entry.id) })}
                />
            ))}
            <div className="workout-manager-toolbar">
                <ExerciseSelect
                    exercises={exercises}
                    categories={categories}
                    value={adding}
                    placeholder="Add an exercise..."
                    onChange={addExercise}
                />
            </div>
        </div>
    )
}

function LogTab({ database, categories, units, onAddWorkout, onSaveWorkout, onRemoveWorkout }) {
    const [date, setDate] = useState(() => todayKey())
    const [sessionId, setSessionId] = useState("")

    const workouts = database.log[date] || []
    // Grouped by program so the picker reads the way the plans are organised.
    const programs = useMemo(
        () => Object.values(database.programs)
            .filter(program => program.sessions.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name)),
        [database.programs]
    )
    const sessionCount = programs.reduce((total, program) => total + program.sessions.length, 0)

    const startSession = useCallback(() => {
        const found = findSession(database, sessionId)
        if (!found) return
        onAddWorkout(date, workoutFromSession(found.session, new Date().toISOString(), found.program))
        setSessionId("")
    }, [database, sessionId, date, onAddWorkout])

    return (
        <div>
            <div className="workout-manager-toolbar">
                <Button icon="bx-chevron-left" title="Previous day" onClick={() => setDate(shiftDateKey(date, -1))} />
                <input type="date" value={date} onInput={e => setDate(e.target.value || todayKey())} />
                <Button icon="bx-chevron-right" title="Next day" onClick={() => setDate(shiftDateKey(date, 1))} />
                <Button icon="bx-calendar" text="Today" onClick={() => setDate(todayKey())} />
                <span className="workout-manager-spacer" />
                <select value={sessionId} onChange={e => setSessionId(e.target.value)}>
                    <option value="">{sessionCount === 0 ? "No sessions yet" : "Start from a session..."}</option>
                    {programs.map(program => (
                        <optgroup label={program.name} key={program.id}>
                            {program.sessions.map(session => (
                                <option value={session.id} key={session.id}>{session.name}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <Button icon="bx-play" text="Start" onClick={startSession} disabled={!sessionId} />
                <Button icon="bx-plus" text="Empty Workout" onClick={() => onAddWorkout(date, normalizeWorkout({ name: "Workout" }))} />
            </div>
            {workouts.length === 0 && <p className="workout-manager-hint">Nothing logged on this day.</p>}
            {workouts.map(workout => (
                <Workout
                    key={workout.id}
                    workout={workout}
                    exercises={database.exercises}
                    categories={categories}
                    units={units}
                    onChange={updated => onSaveWorkout(date, updated)}
                    onRemove={() => onRemoveWorkout(date, workout)}
                />
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------

// The personal best that means something for this exercise's measurement.
function bestLabel(exercise, stats, units) {
    switch (measurementOf(exercise).key) {
        case "weight":
            return stats.bestWeight > 0
                ? `${formatNumber(stats.bestWeight)} ${units.weight} · est. 1RM ${formatNumber(stats.bestOneRepMax)} ${units.weight}`
                : "—"
        case "bodyweight":
            return stats.bestReps > 0 ? `${formatNumber(stats.bestReps)} reps` : "—"
        case "duration":
            return stats.bestDuration > 0 ? `${formatNumber(stats.bestDuration)} min` : "—"
        default:
            return [
                stats.bestDistance > 0 ? `${formatNumber(stats.bestDistance)} ${units.distance}` : "",
                stats.bestDuration > 0 ? `${formatNumber(stats.bestDuration)} min` : ""
            ].filter(Boolean).join(" · ") || "—"
    }
}

// One logged set, written the way its exercise is measured.
function setLabel(set, exercise, units) {
    const parts = measurementFields(exercise)
        .filter(field => set[field.key] > 0)
        .map(field => field.unit ? `${formatNumber(set[field.key])} ${units[field.unit]}` : `${formatNumber(set[field.key])} ${field.label.toLowerCase()}`)
    if (set.rpe > 0) parts.push(`RPE ${formatNumber(set.rpe)}`)
    return parts.join(" × ") || "—"
}

function StatsTab({ database, units, weeklyTarget }) {
    const [expanded, setExpanded] = useState(null)

    const weeks = useMemo(() => weeklySummary(database, database.exercises, 8), [database])
    const exercises = useMemo(
        () => Object.values(database.exercises)
            .map(exercise => ({ exercise, stats: exerciseStats(database, exercise.id) }))
            .filter(({ stats }) => stats.workouts > 0)
            .sort((a, b) => (b.stats.lastPerformed || "").localeCompare(a.stats.lastPerformed || "")),
        [database]
    )

    const history = useMemo(() => expanded ? exerciseHistory(database, expanded) : [], [database, expanded])

    return (
        <div>
            <h4 className="workout-manager-heading">Last 8 Weeks</h4>
            <table className="workout-manager-table">
                <thead>
                    <tr>
                        <th>Week Of</th>
                        <th>Workouts</th>
                        <th>Sets</th>
                        <th>Volume ({units.weight})</th>
                        <th>Duration (min)</th>
                        <th>Distance ({units.distance})</th>
                    </tr>
                </thead>
                <tbody>
                    {weeks.map(week => (
                        <tr key={week.weekStart}>
                            <td>{week.weekStart}</td>
                            <td className={week.workouts >= weeklyTarget ? "workout-manager-ok" : ""}>
                                {`${week.workouts} / ${weeklyTarget}`}
                            </td>
                            <td>{week.sets}</td>
                            <td>{formatNumber(week.volume)}</td>
                            <td>{formatNumber(week.duration)}</td>
                            <td>{formatNumber(week.distance)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h4 className="workout-manager-heading">Personal Bests</h4>
            <table className="workout-manager-table">
                <thead>
                    <tr>
                        <th>Exercise</th>
                        <th>Best</th>
                        <th>Sets</th>
                        <th>Volume ({units.weight})</th>
                        <th>Last Done</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {exercises.map(({ exercise, stats }) => (
                        <tr key={exercise.id}>
                            <td>{exercise.name}</td>
                            <td>{bestLabel(exercise, stats, units)}</td>
                            <td>{stats.sets}</td>
                            <td>{stats.totalVolume > 0 ? formatNumber(stats.totalVolume) : "—"}</td>
                            <td>{stats.lastPerformed}</td>
                            <td className="workout-manager-row-actions">
                                <Button
                                    icon={expanded === exercise.id ? "bx-chevron-up" : "bx-history"}
                                    title="History"
                                    onClick={() => setExpanded(expanded === exercise.id ? null : exercise.id)}
                                />
                            </td>
                        </tr>
                    ))}
                    {exercises.length === 0 && (
                        <tr><td colSpan="6" className="workout-manager-hint">Nothing logged yet.</td></tr>
                    )}
                </tbody>
            </table>

            {expanded && database.exercises[expanded] && (
                <div className="workout-manager-card">
                    <div className="workout-manager-card-header">
                        <strong>{database.exercises[expanded].name} history</strong>
                    </div>
                    <ul className="workout-manager-plan">
                        {history.map(record => (
                            <li key={`${record.workoutId}-${record.date}`}>
                                <strong>{record.date}</strong>
                                {` — ${record.sets.map(set => setLabel(set, database.exercises[expanded], units)).join(", ") || "no sets"}`}
                                {record.comment && ` · ${record.comment}`}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Categories tab
// ---------------------------------------------------------------------------
function CategoriesTab({ database, categories, onCreate, onRename, onDelete }) {
    const [draft, setDraft] = useState("")
    const [renaming, setRenaming] = useState(null)
    const [renameDraft, setRenameDraft] = useState("")

    const create = useCallback(() => {
        if (!draft.trim()) return
        onCreate(draft)
        setDraft("")
    }, [draft, onCreate])

    return (
        <div>
            <div className="workout-manager-toolbar">
                <SuggestInput
                    placeholder="New category (use / to nest)..."
                    value={draft}
                    suggestions={categories}
                    onChange={setDraft}
                    onCommit={create}
                />
                <Button icon="bx-plus" text="Add" onClick={create} disabled={!draft.trim()} />
            </div>
            <table className="workout-manager-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Exercises</th>
                        <th>Sessions</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {categories.map(name => {
                        const direct = categoryUsage(database, name)
                        const subtree = categoryUsage(database, name, true)
                        return (
                            <tr key={name}>
                                <td style={{ paddingLeft: `${8 + categoryDepth(name) * 18}px` }}>
                                    {renaming === name ? (
                                        <input
                                            type="text"
                                            value={renameDraft}
                                            autoFocus
                                            onInput={e => setRenameDraft(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === "Enter") { onRename(name, renameDraft); setRenaming(null) }
                                                if (e.key === "Escape") setRenaming(null)
                                            }}
                                        />
                                    ) : categoryLeaf(name)}
                                </td>
                                <td>{direct.exercises === subtree.exercises ? direct.exercises : `${direct.exercises} (${subtree.exercises})`}</td>
                                <td>{direct.sessions === subtree.sessions ? direct.sessions : `${direct.sessions} (${subtree.sessions})`}</td>
                                <td className="workout-manager-row-actions">
                                    <Button
                                        icon="bx-edit"
                                        title="Rename"
                                        onClick={() => { setRenaming(name); setRenameDraft(name) }}
                                    />
                                    <Button icon="bx-trash" title="Delete" onClick={() => onDelete(name, subtree)} />
                                </td>
                            </tr>
                        )
                    })}
                    {categories.length === 0 && (
                        <tr><td colSpan="4" className="workout-manager-hint">No categories.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Root widget
// ---------------------------------------------------------------------------
function WorkoutManagerWidget() {
    const [tab, setTab] = useState("log")
    const [database, setDatabase] = useState(null)
    const [settings, setSettings] = useState(null)
    const [databaseNoteId, setDatabaseNoteId] = useState(null)
    // Mirrors `database` so persist can apply its updater without reading state
    // through a stale closure -- what gets written must be the object itself.
    const databaseRef = useRef(null)

    const units = useMemo(
        () => ({ weight: settings?.weightUnit || "kg", distance: settings?.distanceUnit || "km" }),
        [settings]
    )

    useEffect(() => {
        (async () => {
            const dbNoteId = await currentNote.getRelationValue("database")
            setDatabaseNoteId(dbNoteId)
            const content = await api.runOnBackend(id => api.getNote(id).getContent(), [dbNoteId])
            databaseRef.current = parseDatabase(content)
            setDatabase(databaseRef.current)

            const schemaNoteId = await currentNote.getRelationValue("schemaNote")
            const settingsNote = await currentNote.getRelationTarget("settingsNote")
            const configNote = await settingsNote.getRelationTarget("configNote")
            setSettings(await loadSettings(schemaNoteId, configNote.noteId))
        })()
    }, [])

    const persist = useCallback(update => {
        const next = update(databaseRef.current)
        databaseRef.current = next
        setDatabase(next)
        api.runOnBackend((id, content) => api.getNote(id).setContent(content), [databaseNoteId, serializeDatabase(next)])
    }, [databaseNoteId])

    const onSaveExercise = useCallback(exercise => {
        persist(current => ({ ...current, exercises: { ...current.exercises, [exercise.id]: exercise } }))
    }, [persist])

    /*
     * Deleting an exercise leaves whatever referenced it: session entries and
     * logged sets keep the dangling id, which the UI shows as "Deleted
     * exercise". Rewriting history to erase it would silently change what the
     * log says happened.
     */
    const onDeleteExercise = useCallback(exercise => {
        if (!confirm(`Delete "${exercise.name}"? Workouts already logged keep their sets.`)) return
        persist(current => {
            const exercises = { ...current.exercises }
            delete exercises[exercise.id]
            return { ...current, exercises }
        })
    }, [persist])

    const onSaveProgram = useCallback(program => {
        persist(current => ({ ...current, programs: { ...current.programs, [program.id]: program } }))
    }, [persist])

    const onDeleteProgram = useCallback(program => {
        const count = program.sessions.length
        const detail = count > 0 ? ` Its ${count} session(s) go with it.` : ""
        if (!confirm(`Delete program "${program.name}"?${detail} Workouts already logged are kept.`)) return
        persist(current => {
            const programs = { ...current.programs }
            delete programs[program.id]
            return { ...current, programs }
        })
    }, [persist])

    // A session lives in its program's array, so every write rebuilds that array.
    const updateSessions = useCallback((programId, change) => {
        persist(current => {
            const program = current.programs[programId]
            if (!program) return current
            return {
                ...current,
                programs: { ...current.programs, [programId]: { ...program, sessions: change(program.sessions) } }
            }
        })
    }, [persist])

    const onSaveSession = useCallback((programId, session) => {
        updateSessions(programId, sessions => sessions.some(existing => existing.id === session.id)
            ? sessions.map(existing => existing.id === session.id ? session : existing)
            : [...sessions, session])
    }, [updateSessions])

    const onDeleteSession = useCallback((programId, session) => {
        if (!confirm(`Delete session "${session.name}"? Workouts logged from it are kept.`)) return
        updateSessions(programId, sessions => sessions.filter(existing => existing.id !== session.id))
    }, [updateSessions])

    // Reordering swaps with the neighbour, which is what the up/down arrows mean.
    const onMoveSession = useCallback((programId, sessionId, delta) => {
        updateSessions(programId, sessions => {
            const index = sessions.findIndex(session => session.id === sessionId)
            const target = index + delta
            if (index < 0 || target < 0 || target >= sessions.length) return sessions
            const next = [...sessions]
            next[index] = sessions[target]
            next[target] = sessions[index]
            return next
        })
    }, [updateSessions])

    const onAddWorkout = useCallback((date, workout) => {
        persist(current => ({ ...current, log: { ...current.log, [date]: [...(current.log[date] || []), workout] } }))
    }, [persist])

    const onSaveWorkout = useCallback((date, workout) => {
        persist(current => ({
            ...current,
            log: { ...current.log, [date]: (current.log[date] || []).map(s => s.id === workout.id ? workout : s) }
        }))
    }, [persist])

    // The day's key is dropped once its last workout goes, so an empty day
    // leaves nothing behind in the document.
    const onRemoveWorkout = useCallback((date, workout) => {
        if (!confirm(`Delete "${workout.name}" logged on ${date}?`)) return
        persist(current => {
            const remaining = (current.log[date] || []).filter(s => s.id !== workout.id)
            const log = { ...current.log }
            if (remaining.length > 0) log[date] = remaining
            else delete log[date]
            return { ...current, log }
        })
    }, [persist])

    const onCreateCategory = useCallback(name => {
        persist(current => addCategory(current, name))
    }, [persist])

    const onRenameCategory = useCallback((from, to) => {
        persist(current => renameCategory(current, from, to))
    }, [persist])

    // `usage` counts the whole subtree, since deleting takes subcategories with it.
    const onDeleteCategory = useCallback((name, usage) => {
        const affected = usage.exercises + usage.sessions > 0
            ? ` It is removed from ${usage.exercises} exercise(s) and ${usage.sessions} session(s), including any subcategories.`
            : " Any subcategories go with it."
        if (!confirm(`Delete category "${name}"?${affected} The exercises and sessions themselves are kept.`)) return
        persist(current => deleteCategory(current, name))
    }, [persist])

    const onStartSession = useCallback((program, session) => {
        onAddWorkout(todayKey(), workoutFromSession(session, new Date().toISOString(), program))
        setTab("log")
    }, [onAddWorkout])

    // Exports the whole database (exercises + sessions + log) as one JSON file.
    const onExport = useCallback(() => {
        const blob = new Blob([exportDatabase(database)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "workout-manager-database.json"
        link.click()
        URL.revokeObjectURL(url)
    }, [database])

    /*
     * Merges an imported database into the current one: imported exercises,
     * sessions and workouts are added by id alongside whatever already exists,
     * so importing the same file twice is a no-op rather than duplicating
     * workouts, and existing data is never wiped.
     */
    const mergeImported = useCallback(imported => {
        persist(current => {
            const log = { ...current.log }
            for (const [date, workouts] of Object.entries(imported.log)) {
                const existingIds = new Set((log[date] || []).map(workout => workout.id))
                log[date] = [...(log[date] || []), ...workouts.filter(workout => !existingIds.has(workout.id))]
            }
            // A program already present keeps its own sessions and gains any
            // imported one whose id it does not already hold.
            const programs = { ...current.programs }
            for (const [id, program] of Object.entries(imported.programs)) {
                const existing = programs[id]
                if (!existing) {
                    programs[id] = program
                    continue
                }
                const existingIds = new Set(existing.sessions.map(session => session.id))
                programs[id] = {
                    ...existing,
                    sessions: [...existing.sessions, ...program.sessions.filter(session => !existingIds.has(session.id))]
                }
            }
            return {
                categories: normalizeTags([...current.categories, ...imported.categories]),
                exercises: { ...current.exercises, ...imported.exercises },
                programs,
                log
            }
        })
    }, [persist])

    // Reads one picked file and hands its text to `convert`, which returns the
    // database to merge plus the line to report.
    const importFile = useCallback((accept, convert) => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = accept
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            let result
            try {
                result = convert(await file.text())
            } catch (e) {
                api.showError(`Could not import: ${e.message}`)
                return
            }
            mergeImported(result.database)
            api.showMessage(result.message)
        }
        input.click()
    }, [mergeImported])

    const onImport = useCallback(() => {
        importFile("application/json,.json", text => {
            const database = importDatabase(text)
            return {
                database,
                message: `Imported ${Object.keys(database.exercises).length} exercise(s) and `
                    + `${allSessions(database).length} session(s) in `
                    + `${Object.keys(database.programs).length} program(s).`
            }
        })
    }, [importFile])

    /*
     * Liftosaur's own exports, converted on the way in. Its weights carry their
     * own unit, so the summary says which one everything landed in -- this
     * addon labels weights rather than converting them, and the setting has to
     * match for the numbers to read correctly.
     */
    const onImportLiftosaur = useCallback(() => {
        importFile("application/json,.json,text/csv,.csv", text => {
            const { database, summary } = convertLiftosaurExport(text)
            const unitNote = summary.unit === units.weight
                ? ""
                : ` Weights are in ${summary.unit} — set Weight Unit to ${summary.unit} in settings to match.`
            return {
                database,
                message: `Imported ${summary.workouts} workout(s), ${summary.sets} set(s) and `
                    + `${summary.exercises} exercise(s) from Liftosaur `
                    + `(skipped ${summary.warmupSets} warmup and ${summary.incompleteSets} unperformed set(s)).${unitNote}`
            }
        })
    }, [importFile, units.weight])

    const categories = useMemo(() => database ? allCategories(database) : [], [database])

    if (!database || !settings) return <div className="workout-manager-widget">Loading...</div>

    const tabButton = (key, label) => (
        <button
            className={tab === key ? "workout-manager-tab-btn workout-manager-tab-btn-active" : "workout-manager-tab-btn"}
            onClick={() => setTab(key)}
        >
            {label}
        </button>
    )

    return (
        <div className="workout-manager-widget">
            <div className="workout-manager-tabs">
                {tabButton("log", "Log")}
                {tabButton("programs", "Programs")}
                {tabButton("exercises", "Exercises")}
                {tabButton("stats", "Stats")}
                {tabButton("categories", "Categories")}
                <span className="workout-manager-spacer" />
                <Button icon="bx-import" text="Import JSON" onClick={onImport} />
                <Button icon="bx-dumbbell" text="Import Liftosaur" onClick={onImportLiftosaur} />
                <Button icon="bx-export" text="Export JSON" onClick={onExport} />
            </div>
            {tab === "log" && (
                <LogTab
                    database={database}
                    categories={categories}
                    units={units}
                    onAddWorkout={onAddWorkout}
                    onSaveWorkout={onSaveWorkout}
                    onRemoveWorkout={onRemoveWorkout}
                />
            )}
            {tab === "programs" && (
                <ProgramsTab
                    database={database}
                    categories={categories}
                    units={units}
                    defaultRest={settings.defaultRest}
                    onSaveProgram={onSaveProgram}
                    onDeleteProgram={onDeleteProgram}
                    onSaveSession={onSaveSession}
                    onDeleteSession={onDeleteSession}
                    onMoveSession={onMoveSession}
                    onStart={onStartSession}
                />
            )}
            {tab === "exercises" && (
                <ExercisesTab
                    database={database}
                    categories={categories}
                    onSave={onSaveExercise}
                    onDelete={onDeleteExercise}
                />
            )}
            {tab === "stats" && (
                <StatsTab database={database} units={units} weeklyTarget={settings.weeklyTarget} />
            )}
            {tab === "categories" && (
                <CategoriesTab
                    database={database}
                    categories={categories}
                    onCreate={onCreateCategory}
                    onRename={onRenameCategory}
                    onDelete={onDeleteCategory}
                />
            )}
        </div>
    )
}

export default WorkoutManagerWidget
