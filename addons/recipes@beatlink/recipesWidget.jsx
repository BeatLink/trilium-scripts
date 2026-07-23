import { useState, useEffect, useCallback, useMemo, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

const {
    NUTRIENTS,
    newId,
    emptyNutrients,
    normalizeFood,
    normalizeRecipe,
    normalizeDiaryEntry,
    parseDatabase,
    serializeDatabase,
    recipeNutrientsPerServing,
    dayTotals,
    targetKeyFor,
    todayKey,
    shiftDateKey
} = require("libRecipes.js")
const { searchFoods } = require("libUsda.js")

// ---------------------------------------------------------------------------
// Shared nutrient input grid — used by both the Add/Edit Food form and the
// USDA lookup preview (pre-filled but still editable before saving).
// ---------------------------------------------------------------------------
function NutrientInputs({ nutrients, onChange }) {
    return (
        <div className="recipes-nutrient-grid">
            {NUTRIENTS.map(n => (
                <label className="recipes-nutrient-field" key={n.key}>
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
// Foods tab
// ---------------------------------------------------------------------------
function FoodForm({ initial, usdaApiKey, onSave, onCancel }) {
    const [food, setFood] = useState(() => normalizeFood(initial))
    const [query, setQuery] = useState("")
    const [results, setResults] = useState(null)
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState(null)

    const setNutrient = useCallback((key, value) => {
        setFood(current => ({ ...current, nutrients: { ...current.nutrients, [key]: value } }))
    }, [])

    const runSearch = useCallback(async () => {
        if (!query.trim()) return
        setSearching(true)
        setError(null)
        try {
            setResults(await searchFoods(usdaApiKey, query.trim()))
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
        <div className="recipes-form">
            <h3>{initial ? "Edit Food" : "Add Food"}</h3>

            <div className="recipes-usda-search">
                <input
                    type="text"
                    placeholder={usdaApiKey ? "Search USDA FoodData Central..." : "Set a USDA API key in Settings to enable search"}
                    value={query}
                    disabled={!usdaApiKey}
                    onInput={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runSearch()}
                />
                <Button text={searching ? "Searching..." : "Search"} disabled={!usdaApiKey || searching} onClick={runSearch} />
            </div>
            {error && <div className="recipes-error">{error}</div>}
            {results && (
                <ul className="recipes-usda-results">
                    {results.length === 0 && <li className="recipes-usda-empty">No results.</li>}
                    {results.map(result => (
                        <li key={result.fdcId}>
                            <span>{result.name}</span>
                            <Button text="Use" onClick={() => applyResult(result)} />
                        </li>
                    ))}
                </ul>
            )}

            <label className="recipes-field">
                <span>Name</span>
                <input type="text" value={food.name} onInput={e => setFood(c => ({ ...c, name: e.target.value }))} />
            </label>
            <div className="recipes-field-row">
                <label className="recipes-field">
                    <span>Serving Size</span>
                    <input
                        type="number"
                        step="0.01"
                        value={food.servingSize}
                        onInput={e => setFood(c => ({ ...c, servingSize: parseFloat(e.target.value) || 0 }))}
                    />
                </label>
                <label className="recipes-field">
                    <span>Serving Unit</span>
                    <input type="text" value={food.servingUnit} onInput={e => setFood(c => ({ ...c, servingUnit: e.target.value }))} />
                </label>
            </div>

            <NutrientInputs nutrients={food.nutrients} onChange={setNutrient} />

            <div className="recipes-form-actions">
                <Button text="Save" onClick={() => onSave(food)} disabled={!food.name.trim()} />
                <Button text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

function FoodsTab({ foods, usdaApiKey, onSaveFood, onDeleteFood }) {
    const [editingId, setEditingId] = useState(null)
    const [adding, setAdding] = useState(false)

    const list = useMemo(() => Object.values(foods).sort((a, b) => a.name.localeCompare(b.name)), [foods])

    if (adding) {
        return <FoodForm usdaApiKey={usdaApiKey} onSave={food => { onSaveFood(food); setAdding(false) }} onCancel={() => setAdding(false)} />
    }
    if (editingId) {
        return (
            <FoodForm
                initial={foods[editingId]}
                usdaApiKey={usdaApiKey}
                onSave={food => { onSaveFood(food); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
            />
        )
    }

    return (
        <div className="recipes-tab">
            <div className="recipes-toolbar">
                <Button icon="bx-plus" text="Add Food" onClick={() => setAdding(true)} />
            </div>
            <table className="recipes-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Serving</th>
                        <th>Calories</th>
                        <th>Protein</th>
                        <th>Carbs</th>
                        <th>Fat</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {list.map(food => (
                        <tr key={food.id}>
                            <td>{food.name}</td>
                            <td>{food.servingSize} {food.servingUnit}</td>
                            <td>{food.nutrients.calories}</td>
                            <td>{food.nutrients.protein}g</td>
                            <td>{food.nutrients.carbs}g</td>
                            <td>{food.nutrients.fat}g</td>
                            <td className="recipes-cell-actions">
                                <button className="recipes-action bx bx-edit" title="Edit" onClick={() => setEditingId(food.id)} />
                                <button className="recipes-action recipes-action-remove bx bx-trash" title="Delete" onClick={() => onDeleteFood(food.id)} />
                            </td>
                        </tr>
                    ))}
                    {list.length === 0 && <tr><td colSpan={7} className="recipes-empty">No foods yet.</td></tr>}
                </tbody>
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
        <div className="recipes-form">
            <h3>{initial ? "Edit Recipe" : "Add Recipe"}</h3>
            <label className="recipes-field">
                <span>Name</span>
                <input type="text" value={recipe.name} onInput={e => setRecipe(c => ({ ...c, name: e.target.value }))} />
            </label>
            <label className="recipes-field">
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
            <ul className="recipes-ingredient-list">
                {recipe.ingredients.map((ing, index) => (
                    <li key={index} className="recipes-ingredient-row">
                        <span className="recipes-ingredient-name">{foods[ing.foodId]?.name || "(deleted food)"}</span>
                        <input
                            type="number"
                            step="0.01"
                            value={ing.amount}
                            onInput={e => updateIngredient(index, parseFloat(e.target.value) || 0)}
                        />
                        <span>{foods[ing.foodId]?.servingUnit || ""}</span>
                        <button className="recipes-action recipes-action-remove bx bx-trash" onClick={() => removeIngredient(index)} />
                    </li>
                ))}
                {recipe.ingredients.length === 0 && <li className="recipes-empty">No ingredients yet.</li>}
            </ul>
            <div className="recipes-add-ingredient">
                <select value={addFoodId} onChange={e => setAddFoodId(e.target.value)}>
                    <option value="">Add ingredient...</option>
                    {foodList.map(food => <option value={food.id} key={food.id}>{food.name}</option>)}
                </select>
                <Button text="Add" onClick={addIngredient} disabled={!addFoodId} />
            </div>

            <div className="recipes-preview">
                <strong>Per serving:</strong> {perServing.calories.toFixed(0)} kcal,
                {" "}{perServing.protein.toFixed(1)}g protein,
                {" "}{perServing.carbs.toFixed(1)}g carbs,
                {" "}{perServing.fat.toFixed(1)}g fat
            </div>

            <div className="recipes-form-actions">
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
        <div className="recipes-tab">
            <div className="recipes-toolbar">
                <Button icon="bx-plus" text="Add Recipe" onClick={() => setAdding(true)} />
            </div>
            <table className="recipes-table">
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
                                <td className="recipes-cell-actions">
                                    <button className="recipes-action bx bx-edit" title="Edit" onClick={() => setEditingId(recipe.id)} />
                                    <button className="recipes-action recipes-action-remove bx bx-trash" title="Delete" onClick={() => onDeleteRecipe(recipe.id)} />
                                </td>
                            </tr>
                        )
                    })}
                    {list.length === 0 && <tr><td colSpan={5} className="recipes-empty">No recipes yet.</td></tr>}
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

    const addEntry = useCallback(() => {
        if (!refId) return
        onAddEntry(date, { kind, refId, servings })
        setRefId("")
        setServings(1)
    }, [date, kind, refId, servings, onAddEntry])

    return (
        <div className="recipes-tab">
            <div className="recipes-diary-nav">
                <button className="recipes-action bx bx-chevron-left" onClick={() => setDate(d => shiftDateKey(d, -1))} title="Previous day" />
                <input type="date" value={date} onInput={e => setDate(e.target.value)} />
                <button className="recipes-action bx bx-chevron-right" onClick={() => setDate(d => shiftDateKey(d, 1))} title="Next day" />
                <Button text="Today" onClick={() => setDate(todayKey())} />
            </div>

            <div className="recipes-diary-totals">
                {NUTRIENTS.map(n => {
                    const target = settings[targetKeyFor(n.key)]
                    const value = totals[n.key]
                    const overTarget = target > 0 && value > target
                    return (
                        <div className={overTarget ? "recipes-target recipes-target-over" : "recipes-target"} key={n.key}>
                            <span className="recipes-target-label">{n.label}</span>
                            <span className="recipes-target-value">
                                {value.toFixed(n.key === "calories" ? 0 : 1)}
                                {target > 0 && ` / ${target}`} {n.unit}
                            </span>
                        </div>
                    )
                })}
            </div>

            <ul className="recipes-diary-entries">
                {entries.map(entry => {
                    const item = entry.kind === "food" ? foods[entry.refId] : recipes[entry.refId]
                    return (
                        <li key={entry.id} className="recipes-diary-entry">
                            <span>{item?.name || "(deleted)"}</span>
                            <span className="recipes-diary-entry-servings">{entry.servings}x</span>
                            <button className="recipes-action recipes-action-remove bx bx-trash" onClick={() => onRemoveEntry(date, entry.id)} />
                        </li>
                    )
                })}
                {entries.length === 0 && <li className="recipes-empty">Nothing logged for this day.</li>}
            </ul>

            <div className="recipes-add-ingredient">
                <select value={kind} onChange={e => { setKind(e.target.value); setRefId("") }}>
                    <option value="food">Food</option>
                    <option value="recipe">Recipe</option>
                </select>
                <select value={refId} onChange={e => setRefId(e.target.value)}>
                    <option value="">Select {kind}...</option>
                    {sortedOptions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
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
function RecipesWidget() {
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

    if (!database || !settings) return <div className="recipes-widget">Loading...</div>

    return (
        <div className="recipes-widget">
            <div className="recipes-tabs">
                <button className={tab === "diary" ? "recipes-tab-btn recipes-tab-btn-active" : "recipes-tab-btn"} onClick={() => setTab("diary")}>Diary</button>
                <button className={tab === "foods" ? "recipes-tab-btn recipes-tab-btn-active" : "recipes-tab-btn"} onClick={() => setTab("foods")}>Foods</button>
                <button className={tab === "recipes" ? "recipes-tab-btn recipes-tab-btn-active" : "recipes-tab-btn"} onClick={() => setTab("recipes")}>Recipes</button>
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

export default RecipesWidget
