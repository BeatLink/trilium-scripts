import { useState, useEffect, useCallback, useMemo, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

const {
    NUTRIENTS,
    newId,
    emptyNutrients,
    normalizeTags,
    normalizeFood,
    allTags,
    normalizeRecipe,
    normalizeDiaryEntry,
    parseDatabase,
    serializeDatabase,
    recipeNutrientsPerServing,
    dayTotals,
    targetKeyFor,
    todayKey,
    shiftDateKey,
    exportDatabase,
    importDatabase
} = require("libDietManager.js")
const { searchFoods: searchUsda } = require("libUsda.js")
const { searchFoods: searchOpenFoodFacts } = require("libOpenFoodFacts.js")

// ---------------------------------------------------------------------------
// Shared nutrient input grid — used by both the Add/Edit Food form and the
// USDA lookup preview (pre-filled but still editable before saving).
// ---------------------------------------------------------------------------
function NutrientInputs({ nutrients, onChange }) {
    return (
        <div className="diet-manager-nutrient-grid">
            {NUTRIENTS.map(n => (
                <label className="diet-manager-nutrient-field" key={n.key}>
                    <span>{n.label} ({n.unit})</span>
                    <input
                        type="number"
                        step="0.01"
                        value={nutrients[n.key]}
                        onInput={e => onChange(n.key, parseFloat(e.target.value) || 0)}
                    />
                </label>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Category tag editor — chips plus a free-text field that autocompletes
// against the tags already used elsewhere in the database.
// ---------------------------------------------------------------------------
function TagEditor({ tags, suggestions, onChange }) {
    const [draft, setDraft] = useState("")

    const addDraft = useCallback(() => {
        const trimmed = draft.trim()
        if (!trimmed) return
        onChange(normalizeTags([...tags, trimmed]))
        setDraft("")
    }, [draft, tags, onChange])

    return (
        <div className="diet-manager-field">
            <span>Categories</span>
            <div className="diet-manager-tag-chips">
                {tags.map(tag => (
                    <span className="diet-manager-tag" key={tag}>
                        {tag}
                        <button
                            className="diet-manager-tag-remove bx bx-x"
                            title="Remove category"
                            onClick={() => onChange(tags.filter(t => t !== tag))}
                        />
                    </span>
                ))}
                {tags.length === 0 && <span className="diet-manager-hint">No categories.</span>}
            </div>
            <div className="diet-manager-tag-add">
                <input
                    type="text"
                    list="diet-manager-tag-suggestions"
                    placeholder="Add a category..."
                    value={draft}
                    onInput={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addDraft() } }}
                />
                <datalist id="diet-manager-tag-suggestions">
                    {suggestions.filter(tag => !tags.includes(tag)).map(tag => <option value={tag} key={tag} />)}
                </datalist>
                <Button text="Add" onClick={addDraft} disabled={!draft.trim()} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Foods tab
// ---------------------------------------------------------------------------
function FoodForm({ initial, usdaApiKey, tagSuggestions, onSave, onCancel }) {
    const [food, setFood] = useState(() => normalizeFood(initial))
    const [query, setQuery] = useState("")
    const [results, setResults] = useState(null)
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState(null)

    const setNutrient = useCallback((key, value) => {
        setFood(current => ({ ...current, nutrients: { ...current.nutrients, [key]: value } }))
    }, [])

    const runSearch = useCallback(async () => {
        const trimmed = query.trim()
        if (!trimmed) return
        setSearching(true)
        setError(null)
        try {
            // Open Food Facts needs no key, so it always runs; USDA only runs
            // if a key is configured. Each source's own failure is reported
            // without blocking the other's results (Promise.allSettled), so
            // e.g. a bad USDA key doesn't hide valid Open Food Facts hits.
            const [offResult, usdaResult] = await Promise.allSettled([
                searchOpenFoodFacts(trimmed),
                usdaApiKey ? searchUsda(usdaApiKey, trimmed) : Promise.resolve([])
            ])
            const merged = [
                ...(offResult.status === "fulfilled" ? offResult.value.map(r => ({ ...r, source: "Open Food Facts", key: `off-${r.code}` })) : []),
                ...(usdaResult.status === "fulfilled" ? usdaResult.value.map(r => ({ ...r, source: "USDA", key: `usda-${r.fdcId}` })) : [])
            ]
            setResults(merged)
            const failures = [offResult, usdaResult].filter(r => r.status === "rejected").map(r => r.reason?.message).filter(Boolean)
            if (failures.length > 0) setError(failures.join(" "))
        } catch (e) {
            setError(e.message)
            setResults(null)
        } finally {
            setSearching(false)
        }
    }, [query, usdaApiKey])

    const applyResult = useCallback(result => {
        setFood(current => ({
            ...current,
            name: current.name || result.name,
            servingSize: result.servingSize,
            servingUnit: result.servingUnit,
            nutrients: result.nutrients
        }))
        setResults(null)
    }, [])

    return (
        <div className="diet-manager-form">
            <h3>{initial ? "Edit Food" : "Add Food"}</h3>

            <div className="diet-manager-usda-search">
                <input
                    type="text"
                    placeholder={usdaApiKey ? "Search USDA and Open Food Facts..." : "Search Open Food Facts... (set a USDA API key in Settings to also search USDA)"}
                    value={query}
                    onInput={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runSearch()}
                />
                <Button text={searching ? "Searching..." : "Search"} disabled={searching} onClick={runSearch} />
            </div>
            {error && <div className="diet-manager-error">{error}</div>}
            {results && (
                <ul className="diet-manager-usda-results">
                    {results.length === 0 && <li className="diet-manager-usda-empty">No results.</li>}
                    {results.map(result => (
                        <li key={result.key}>
                            <span>{result.name} <span className="diet-manager-usda-source">{result.source}</span></span>
                            <Button text="Use" onClick={() => applyResult(result)} />
                        </li>
                    ))}
                </ul>
            )}

            <label className="diet-manager-field">
                <span>Name</span>
                <input type="text" value={food.name} onInput={e => setFood(c => ({ ...c, name: e.target.value }))} />
            </label>
            <div className="diet-manager-field-row">
                <label className="diet-manager-field">
                    <span>Serving Size</span>
                    <input
                        type="number"
                        step="0.01"
                        value={food.servingSize}
                        onInput={e => setFood(c => ({ ...c, servingSize: parseFloat(e.target.value) || 0 }))}
                    />
                </label>
                <label className="diet-manager-field">
                    <span>Serving Unit</span>
                    <input type="text" value={food.servingUnit} onInput={e => setFood(c => ({ ...c, servingUnit: e.target.value }))} />
                </label>
            </div>

            <TagEditor
                tags={food.tags}
                suggestions={tagSuggestions}
                onChange={tags => setFood(c => ({ ...c, tags }))}
            />

            <NutrientInputs nutrients={food.nutrients} onChange={setNutrient} />

            <div className="diet-manager-form-actions">
                <Button text="Save" onClick={() => onSave(food)} disabled={!food.name.trim()} />
                <Button text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

// Sortable columns of the foods table: `value` sorts, `render` draws the cell.
const FOOD_COLUMNS = [
    { key: "name", label: "Name", value: food => food.name, render: food => food.name },
    { key: "tags", label: "Categories", value: food => food.tags.join(", "), render: food => food.tags.join(", ") },
    { key: "serving", label: "Serving", value: food => food.servingSize, render: food => `${food.servingSize} ${food.servingUnit}` },
    { key: "calories", label: "Calories", value: food => food.nutrients.calories, render: food => food.nutrients.calories },
    { key: "protein", label: "Protein", value: food => food.nutrients.protein, render: food => `${food.nutrients.protein}g` },
    { key: "carbs", label: "Carbs", value: food => food.nutrients.carbs, render: food => `${food.nutrients.carbs}g` },
    { key: "fat", label: "Fat", value: food => food.nutrients.fat, render: food => `${food.nutrients.fat}g` }
]

const UNTAGGED = "(uncategorized)"

function sortFoods(list, sortKey, ascending) {
    const column = FOOD_COLUMNS.find(c => c.key === sortKey) ?? FOOD_COLUMNS[0]
    const direction = ascending ? 1 : -1
    return [...list].sort((a, b) => {
        const left = column.value(a)
        const right = column.value(b)
        const order = typeof left === "number" ? left - right : String(left).localeCompare(String(right))
        return order * direction
    })
}

function FoodRows({ list, onEdit, onDelete }) {
    return list.map(food => (
        <tr key={food.id}>
            {FOOD_COLUMNS.map(column => <td key={column.key}>{column.render(food)}</td>)}
            <td className="diet-manager-cell-actions">
                <button className="diet-manager-action bx bx-edit" title="Edit" onClick={() => onEdit(food.id)} />
                <button className="diet-manager-action diet-manager-action-remove bx bx-trash" title="Delete" onClick={() => onDelete(food.id)} />
            </td>
        </tr>
    ))
}

function FoodsTab({ foods, usdaApiKey, onSaveFood, onDeleteFood }) {
    const [editingId, setEditingId] = useState(null)
    const [adding, setAdding] = useState(false)
    const [filterTag, setFilterTag] = useState("")
    const [grouped, setGrouped] = useState(false)
    const [sortKey, setSortKey] = useState("name")
    const [ascending, setAscending] = useState(true)

    const tags = useMemo(() => allTags(foods), [foods])

    const filtered = useMemo(() => {
        const list = Object.values(foods)
        if (!filterTag) return list
        if (filterTag === UNTAGGED) return list.filter(food => food.tags.length === 0)
        return list.filter(food => food.tags.includes(filterTag))
    }, [foods, filterTag])

    const list = useMemo(() => sortFoods(filtered, sortKey, ascending), [filtered, sortKey, ascending])

    // A food with several categories appears under each of them.
    const groups = useMemo(() => {
        const byTag = tags.map(tag => [tag, list.filter(food => food.tags.includes(tag))])
        const untagged = list.filter(food => food.tags.length === 0)
        if (untagged.length > 0) byTag.push([UNTAGGED, untagged])
        return byTag.filter(([, members]) => members.length > 0)
    }, [tags, list])

    const toggleSort = useCallback(key => {
        if (key === sortKey) setAscending(asc => !asc)
        else { setSortKey(key); setAscending(true) }
    }, [sortKey])

    if (adding) {
        return (
            <FoodForm
                usdaApiKey={usdaApiKey}
                tagSuggestions={tags}
                onSave={food => { onSaveFood(food); setAdding(false) }}
                onCancel={() => setAdding(false)}
            />
        )
    }
    if (editingId) {
        return (
            <FoodForm
                initial={foods[editingId]}
                usdaApiKey={usdaApiKey}
                tagSuggestions={tags}
                onSave={food => { onSaveFood(food); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
            />
        )
    }

    const header = (
        <tr>
            {FOOD_COLUMNS.map(column => (
                <th
                    className="diet-manager-sortable"
                    key={column.key}
                    onClick={() => toggleSort(column.key)}
                    title={`Sort by ${column.label}`}
                >
                    {column.label}
                    {sortKey === column.key && <span className="diet-manager-sort-arrow">{ascending ? "▲" : "▼"}</span>}
                </th>
            ))}
            <th />
        </tr>
    )

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <Button icon="bx-plus" text="Add Food" onClick={() => setAdding(true)} />
                <select value={filterTag} onChange={e => setFilterTag(e.target.value)} title="Filter by category">
                    <option value="">All categories</option>
                    {tags.map(tag => <option value={tag} key={tag}>{tag}</option>)}
                    <option value={UNTAGGED}>{UNTAGGED}</option>
                </select>
                <label className="diet-manager-toolbar-check">
                    <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />
                    <span>Group by category</span>
                </label>
            </div>
            <table className="diet-manager-table">
                <thead>{header}</thead>
                {grouped
                    ? groups.map(([tag, members]) => (
                        <tbody key={tag}>
                            <tr className="diet-manager-group-row">
                                <th colSpan={FOOD_COLUMNS.length + 1}>{tag} <span className="diet-manager-hint">({members.length})</span></th>
                            </tr>
                            <FoodRows list={members} onEdit={setEditingId} onDelete={onDeleteFood} />
                        </tbody>
                    ))
                    : <tbody><FoodRows list={list} onEdit={setEditingId} onDelete={onDeleteFood} /></tbody>}
                {list.length === 0 && (
                    <tbody>
                        <tr><td colSpan={FOOD_COLUMNS.length + 1} className="diet-manager-empty">{filterTag ? "No foods in this category." : "No foods yet."}</td></tr>
                    </tbody>
                )}
            </table>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Recipes tab
// ---------------------------------------------------------------------------
function RecipeForm({ initial, foods, onSave, onCancel }) {
    const [recipe, setRecipe] = useState(() => normalizeRecipe(initial))
    const [addFoodId, setAddFoodId] = useState("")

    const foodList = useMemo(() => Object.values(foods).sort((a, b) => a.name.localeCompare(b.name)), [foods])
    const perServing = useMemo(() => recipeNutrientsPerServing(recipe, foods), [recipe, foods])

    const addIngredient = useCallback(() => {
        if (!addFoodId) return
        setRecipe(c => ({ ...c, ingredients: [...c.ingredients, { foodId: addFoodId, amount: foods[addFoodId]?.servingSize ?? 1 }] }))
        setAddFoodId("")
    }, [addFoodId, foods])

    const updateIngredient = useCallback((index, amount) => {
        setRecipe(c => ({ ...c, ingredients: c.ingredients.map((ing, i) => i === index ? { ...ing, amount } : ing) }))
    }, [])

    const removeIngredient = useCallback(index => {
        setRecipe(c => ({ ...c, ingredients: c.ingredients.filter((_, i) => i !== index) }))
    }, [])

    return (
        <div className="diet-manager-form">
            <h3>{initial ? "Edit Recipe" : "Add Recipe"}</h3>
            <label className="diet-manager-field">
                <span>Name</span>
                <input type="text" value={recipe.name} onInput={e => setRecipe(c => ({ ...c, name: e.target.value }))} />
            </label>
            <label className="diet-manager-field">
                <span>Servings</span>
                <input
                    type="number"
                    step="1"
                    min="1"
                    value={recipe.servings}
                    onInput={e => setRecipe(c => ({ ...c, servings: parseFloat(e.target.value) || 1 }))}
                />
            </label>

            <h4>Ingredients</h4>
            <ul className="diet-manager-ingredient-list">
                {recipe.ingredients.map((ing, index) => (
                    <li key={index} className="diet-manager-ingredient-row">
                        <span className="diet-manager-ingredient-name">{foods[ing.foodId]?.name || "(deleted food)"}</span>
                        <input
                            type="number"
                            step="0.01"
                            value={ing.amount}
                            onInput={e => updateIngredient(index, parseFloat(e.target.value) || 0)}
                        />
                        <span>{foods[ing.foodId]?.servingUnit || ""}</span>
                        <button className="diet-manager-action diet-manager-action-remove bx bx-trash" onClick={() => removeIngredient(index)} />
                    </li>
                ))}
                {recipe.ingredients.length === 0 && <li className="diet-manager-empty">No ingredients yet.</li>}
            </ul>
            <div className="diet-manager-add-ingredient">
                <select value={addFoodId} onChange={e => setAddFoodId(e.target.value)}>
                    <option value="">Add ingredient...</option>
                    {foodList.map(food => <option value={food.id} key={food.id}>{food.name}</option>)}
                </select>
                <Button text="Add" onClick={addIngredient} disabled={!addFoodId} />
            </div>

            <div className="diet-manager-preview">
                <strong>Per serving:</strong> {perServing.calories.toFixed(0)} kcal,
                {" "}{perServing.protein.toFixed(1)}g protein,
                {" "}{perServing.carbs.toFixed(1)}g carbs,
                {" "}{perServing.fat.toFixed(1)}g fat
            </div>

            <div className="diet-manager-form-actions">
                <Button text="Save" onClick={() => onSave(recipe)} disabled={!recipe.name.trim()} />
                <Button text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

function RecipesTab({ recipes, foods, onSaveRecipe, onDeleteRecipe }) {
    const [editingId, setEditingId] = useState(null)
    const [adding, setAdding] = useState(false)

    const list = useMemo(() => Object.values(recipes).sort((a, b) => a.name.localeCompare(b.name)), [recipes])

    if (adding) {
        return <RecipeForm foods={foods} onSave={recipe => { onSaveRecipe(recipe); setAdding(false) }} onCancel={() => setAdding(false)} />
    }
    if (editingId) {
        return (
            <RecipeForm
                initial={recipes[editingId]}
                foods={foods}
                onSave={recipe => { onSaveRecipe(recipe); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
            />
        )
    }

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <Button icon="bx-plus" text="Add Recipe" onClick={() => setAdding(true)} />
            </div>
            <table className="diet-manager-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Servings</th>
                        <th>Calories / serving</th>
                        <th>Protein / serving</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {list.map(recipe => {
                        const perServing = recipeNutrientsPerServing(recipe, foods)
                        return (
                            <tr key={recipe.id}>
                                <td>{recipe.name}</td>
                                <td>{recipe.servings}</td>
                                <td>{perServing.calories.toFixed(0)}</td>
                                <td>{perServing.protein.toFixed(1)}g</td>
                                <td className="diet-manager-cell-actions">
                                    <button className="diet-manager-action bx bx-edit" title="Edit" onClick={() => setEditingId(recipe.id)} />
                                    <button className="diet-manager-action diet-manager-action-remove bx bx-trash" title="Delete" onClick={() => onDeleteRecipe(recipe.id)} />
                                </td>
                            </tr>
                        )
                    })}
                    {list.length === 0 && <tr><td colSpan={5} className="diet-manager-empty">No recipes yet.</td></tr>}
                </tbody>
            </table>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Diary tab
// ---------------------------------------------------------------------------
function DiaryTab({ diary, foods, recipes, settings, onAddEntry, onRemoveEntry }) {
    const [date, setDate] = useState(() => todayKey())
    const [kind, setKind] = useState("food")
    const [refId, setRefId] = useState("")
    const [servings, setServings] = useState(1)

    const entries = diary[date] || []
    const totals = useMemo(() => dayTotals(entries, foods, recipes), [entries, foods, recipes])

    const options = kind === "food" ? Object.values(foods) : Object.values(recipes)
    const sortedOptions = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options])

    // Foods are offered grouped by category; a food in several categories is listed under each.
    const foodGroups = useMemo(() => {
        if (kind !== "food") return []
        const groups = allTags(foods).map(tag => [tag, sortedOptions.filter(food => food.tags.includes(tag))])
        const untagged = sortedOptions.filter(food => food.tags.length === 0)
        if (untagged.length > 0) groups.push([UNTAGGED, untagged])
        return groups
    }, [kind, foods, sortedOptions])

    const addEntry = useCallback(() => {
        if (!refId) return
        onAddEntry(date, { kind, refId, servings })
        setRefId("")
        setServings(1)
    }, [date, kind, refId, servings, onAddEntry])

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-diary-nav">
                <button className="diet-manager-action bx bx-chevron-left" onClick={() => setDate(d => shiftDateKey(d, -1))} title="Previous day" />
                <input type="date" value={date} onInput={e => setDate(e.target.value)} />
                <button className="diet-manager-action bx bx-chevron-right" onClick={() => setDate(d => shiftDateKey(d, 1))} title="Next day" />
                <Button text="Today" onClick={() => setDate(todayKey())} />
            </div>

            <div className="diet-manager-diary-totals">
                {NUTRIENTS.map(n => {
                    const target = settings[targetKeyFor(n.key)]
                    const value = totals[n.key]
                    const overTarget = target > 0 && value > target
                    return (
                        <div className={overTarget ? "diet-manager-target diet-manager-target-over" : "diet-manager-target"} key={n.key}>
                            <span className="diet-manager-target-label">{n.label}</span>
                            <span className="diet-manager-target-value">
                                {value.toFixed(n.key === "calories" ? 0 : 1)}
                                {target > 0 && ` / ${target}`} {n.unit}
                            </span>
                        </div>
                    )
                })}
            </div>

            <ul className="diet-manager-diary-entries">
                {entries.map(entry => {
                    const item = entry.kind === "food" ? foods[entry.refId] : recipes[entry.refId]
                    return (
                        <li key={entry.id} className="diet-manager-diary-entry">
                            <span>{item?.name || "(deleted)"}</span>
                            <span className="diet-manager-diary-entry-servings">{entry.servings}x</span>
                            <button className="diet-manager-action diet-manager-action-remove bx bx-trash" onClick={() => onRemoveEntry(date, entry.id)} />
                        </li>
                    )
                })}
                {entries.length === 0 && <li className="diet-manager-empty">Nothing logged for this day.</li>}
            </ul>

            <div className="diet-manager-add-ingredient">
                <select value={kind} onChange={e => { setKind(e.target.value); setRefId("") }}>
                    <option value="food">Food</option>
                    <option value="recipe">Recipe</option>
                </select>
                <select value={refId} onChange={e => setRefId(e.target.value)}>
                    <option value="">Select {kind}...</option>
                    {kind === "recipe"
                        ? sortedOptions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)
                        : foodGroups.map(([tag, members]) => (
                            <optgroup label={tag} key={tag}>
                                {members.map(food => <option value={food.id} key={food.id}>{food.name}</option>)}
                            </optgroup>
                        ))}
                </select>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={servings}
                    onInput={e => setServings(parseFloat(e.target.value) || 1)}
                    title="Servings"
                />
                <Button text="Log" onClick={addEntry} disabled={!refId} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Root widget
// ---------------------------------------------------------------------------
function DietManagerWidget() {
    const [tab, setTab] = useState("diary")
    const [database, setDatabase] = useState(null)
    const [settings, setSettings] = useState(null)
    const [databaseNoteId, setDatabaseNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            const dbNoteId = await currentNote.getRelationValue("database")
            setDatabaseNoteId(dbNoteId)
            const content = await api.runOnBackend(id => api.getNote(id).getContent(), [dbNoteId])
            setDatabase(parseDatabase(content))

            const schemaNoteId = await currentNote.getRelationValue("schemaNote")
            const settingsNote = await currentNote.getRelationTarget("settingsNote")
            const configNote = await settingsNote.getRelationTarget("configNote")
            setSettings(await loadSettings(schemaNoteId, configNote.noteId))
        })()
    }, [])

    const persist = useCallback(next => {
        setDatabase(next)
        api.runOnBackend((id, content) => api.getNote(id).setContent(content), [databaseNoteId, serializeDatabase(next)])
    }, [databaseNoteId])

    const onSaveFood = useCallback(food => {
        persist(current => ({ ...current, foods: { ...current.foods, [food.id]: food } }))
    }, [persist])

    const onDeleteFood = useCallback(id => {
        persist(current => {
            const foods = { ...current.foods }
            delete foods[id]
            return { ...current, foods }
        })
    }, [persist])

    const onSaveRecipe = useCallback(recipe => {
        persist(current => ({ ...current, recipes: { ...current.recipes, [recipe.id]: recipe } }))
    }, [persist])

    const onDeleteRecipe = useCallback(id => {
        persist(current => {
            const recipes = { ...current.recipes }
            delete recipes[id]
            return { ...current, recipes }
        })
    }, [persist])

    const onAddEntry = useCallback((date, entryFields) => {
        persist(current => {
            const entry = normalizeDiaryEntry({ ...entryFields, id: newId() })
            const dayEntries = current.diary[date] || []
            return { ...current, diary: { ...current.diary, [date]: [...dayEntries, entry] } }
        })
    }, [persist])

    const onRemoveEntry = useCallback((date, entryId) => {
        persist(current => ({
            ...current,
            diary: { ...current.diary, [date]: (current.diary[date] || []).filter(e => e.id !== entryId) }
        }))
    }, [persist])

    // Exports the whole database (foods + recipes + diary) as one JSON file.
    const onExport = useCallback(() => {
        const blob = new Blob([exportDatabase(database)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "diet-manager-database.json"
        link.click()
        URL.revokeObjectURL(url)
    }, [database])

    // Merges an imported database into the current one: imported
    // foods/recipes/diary entries are added by id alongside whatever already
    // exists, so importing the same file twice is a no-op rather than
    // duplicating entries, and existing data is never wiped.
    const onImport = useCallback(() => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "application/json,.json"
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            let imported
            try {
                imported = importDatabase(await file.text())
            } catch (e) {
                api.showError(`Could not import: ${e.message}`)
                return
            }
            persist(current => {
                const diary = { ...current.diary }
                for (const [date, entries] of Object.entries(imported.diary)) {
                    const existingIds = new Set((diary[date] || []).map(e => e.id))
                    const newEntries = entries.filter(e => !existingIds.has(e.id))
                    diary[date] = [...(diary[date] || []), ...newEntries]
                }
                return {
                    foods: { ...current.foods, ...imported.foods },
                    recipes: { ...current.recipes, ...imported.recipes },
                    diary
                }
            })
            api.showMessage(
                `Imported ${Object.keys(imported.foods).length} food(s) and ${Object.keys(imported.recipes).length} recipe(s).`
            )
        }
        input.click()
    }, [persist])

    if (!database || !settings) return <div className="diet-manager-widget">Loading...</div>

    return (
        <div className="diet-manager-widget">
            <div className="diet-manager-tabs">
                <button className={tab === "diary" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("diary")}>Diary</button>
                <button className={tab === "foods" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("foods")}>Foods</button>
                <button className={tab === "recipes" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("recipes")}>Recipes</button>
                <span className="diet-manager-tabs-spacer" />
                <Button icon="bx-import" text="Import JSON" onClick={onImport} />
                <Button icon="bx-export" text="Export JSON" onClick={onExport} />
            </div>
            {tab === "diary" && (
                <DiaryTab
                    diary={database.diary}
                    foods={database.foods}
                    recipes={database.recipes}
                    settings={settings}
                    onAddEntry={onAddEntry}
                    onRemoveEntry={onRemoveEntry}
                />
            )}
            {tab === "foods" && (
                <FoodsTab foods={database.foods} usdaApiKey={settings.usdaApiKey} onSaveFood={onSaveFood} onDeleteFood={onDeleteFood} />
            )}
            {tab === "recipes" && (
                <RecipesTab recipes={database.recipes} foods={database.foods} onSaveRecipe={onSaveRecipe} onDeleteRecipe={onDeleteRecipe} />
            )}
        </div>
    )
}

export default DietManagerWidget
