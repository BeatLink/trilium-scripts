import { useState, useEffect, useRef, useCallback, useMemo, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

const {
    NUTRIENTS,
    newId,
    emptyNutrients,
    normalizeTags,
    normalizeCategoryName,
    normalizeFood,
    SERVING_UNIT,
    foodUnits,
    CATEGORY_SEPARATOR,
    categoryDepth,
    categoryLeaf,
    isInCategory,
    allCategories,
    categoryUsage,
    addCategory,
    renameCategory,
    deleteCategory,
    normalizeRecipe,
    normalizeGroceryItem,
    normalizeUnits,
    allUnits,
    unitUsage,
    addUnit,
    renameUnit,
    deleteUnit,
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
// Free-text field with a dropdown of values already in use, shared by the
// category and unit pickers. Clicking or focusing it offers the full list --
// a native <datalist> only opens once the browser feels like it -- and typing
// narrows it, while anything not on the list can still just be typed.
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
        <div className={className ? `diet-manager-suggest ${className}` : "diet-manager-suggest"}>
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
                <ul className="diet-manager-suggestions">
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
// The units one food can be measured in: its whole serving, its serving unit,
// and any extra portion it defines ("1 tortilla = 100 g"). Nutrition is stored
// once per serving and converted from whichever unit is picked.
// ---------------------------------------------------------------------------
function FoodUnitSelect({ food, value, onChange, title }) {
    if (!food) return <span className="diet-manager-hint">—</span>
    const options = foodUnits(food)
    return (
        <select className="diet-manager-unit-select" value={value} title={title} onChange={e => onChange(e.target.value)}>
            {options.map(option => (
                <option value={option.unit} key={option.unit}>
                    {option.unit === SERVING_UNIT ? `serving (${food.servingSize} ${food.servingUnit})` : option.unit}
                </option>
            ))}
        </select>
    )
}

// ---------------------------------------------------------------------------
// Category tag editor — chips plus a free-text field that autocompletes
// against the tags already used elsewhere in the database. The draft lives in
// the parent form so saving can commit a category still sitting in the field.
// ---------------------------------------------------------------------------
function withDraftTag(tags, draft) {
    const trimmed = draft.trim()
    return trimmed ? normalizeTags([...tags, trimmed]) : tags
}

function TagEditor({ tags, draft, suggestions, onChange, onDraftChange }) {
    const addDraft = useCallback(() => {
        if (!draft.trim()) return
        onChange(withDraftTag(tags, draft))
        onDraftChange("")
    }, [draft, tags, onChange, onDraftChange])

    const unused = useMemo(() => suggestions.filter(tag => !tags.includes(tag)), [suggestions, tags])

    const pick = useCallback(tag => {
        onChange(normalizeTags([...tags, tag]))
        onDraftChange("")
    }, [tags, onChange, onDraftChange])

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
                <SuggestInput
                    className="diet-manager-suggest-grow"
                    placeholder="Add a category..."
                    value={draft}
                    suggestions={unused}
                    onChange={onDraftChange}
                    onPick={pick}
                    onCommit={addDraft}
                />
                <Button text="Add" onClick={addDraft} disabled={!draft.trim()} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Foods tab
// ---------------------------------------------------------------------------
function FoodForm({ initial, usdaApiKey, tagSuggestions, unitSuggestions, onSave, onCancel }) {
    const [food, setFood] = useState(() => normalizeFood(initial))
    const [tagDraft, setTagDraft] = useState("")
    const [query, setQuery] = useState("")
    const [results, setResults] = useState(null)
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState(null)

    const setNutrient = useCallback((key, value) => {
        setFood(current => ({ ...current, nutrients: { ...current.nutrients, [key]: value } }))
    }, [])

    const setPortion = useCallback((index, changes) => {
        setFood(current => ({
            ...current,
            portions: current.portions.map((portion, i) => i === index ? { ...portion, ...changes } : portion)
        }))
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
                    <SuggestInput
                        value={food.servingUnit}
                        suggestions={unitSuggestions}
                        placeholder="g, ml, cup..."
                        onChange={unit => setFood(c => ({ ...c, servingUnit: unit }))}
                    />
                </label>
            </div>

            {/* Extra ways to measure this food, each stated in its serving unit. */}
            <div className="diet-manager-field">
                <span>Other Units</span>
                <ul className="diet-manager-portion-list">
                    {food.portions.map((portion, index) => (
                        <li key={index} className="diet-manager-portion-row">
                            <span>1</span>
                            <SuggestInput
                                className="diet-manager-suggest-unit"
                                value={portion.unit}
                                suggestions={unitSuggestions}
                                placeholder="tortilla"
                                onChange={unit => setPortion(index, { unit })}
                            />
                            <span>=</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={portion.size}
                                onInput={e => setPortion(index, { size: parseFloat(e.target.value) || 0 })}
                            />
                            <span>{food.servingUnit}</span>
                            <button
                                className="diet-manager-action diet-manager-action-remove bx bx-trash"
                                title="Remove unit"
                                onClick={() => setFood(c => ({ ...c, portions: c.portions.filter((_, i) => i !== index) }))}
                            />
                        </li>
                    ))}
                    {food.portions.length === 0 && (
                        <li className="diet-manager-hint">
                            Nutrition is per {food.servingSize} {food.servingUnit}. Add a unit to also log this food
                            as whole pieces, packs or cups.
                        </li>
                    )}
                </ul>
                <Button
                    icon="bx-plus"
                    text="Add Unit"
                    onClick={() => setFood(c => ({ ...c, portions: [...c.portions, { unit: "", size: c.servingSize }] }))}
                />
            </div>

            <TagEditor
                tags={food.tags}
                draft={tagDraft}
                suggestions={tagSuggestions}
                onChange={tags => setFood(c => ({ ...c, tags }))}
                onDraftChange={setTagDraft}
            />

            <NutrientInputs nutrients={food.nutrients} onChange={setNutrient} />

            <div className="diet-manager-form-actions">
                <Button
                    text="Save"
                    onClick={() => onSave({ ...food, tags: withDraftTag(food.tags, tagDraft) })}
                    disabled={!food.name.trim()}
                />
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

// View preference, not data, so it lives in localStorage rather than the database note.
const GROCERY_GROUPED_PREF_KEY = "diet-manager-group-grocery-by-category"

// ---------------------------------------------------------------------------
// Shared category view — the filter/group/sort behaviour of the Foods and
// Recipes tabs, which differ only in their columns and their edit form.
// ---------------------------------------------------------------------------
function useCategoryView(items, categories, columns, groupedPrefKey) {
    const [filterTag, setFilterTag] = useState("")
    const [grouped, setGrouped] = useState(() => localStorage.getItem(groupedPrefKey) === "true")
    const [sortKey, setSortKey] = useState("name")
    const [ascending, setAscending] = useState(true)

    // Filtering a parent category includes everything nested under it.
    const filtered = useMemo(() => {
        const list = Object.values(items)
        if (!filterTag) return list
        if (filterTag === UNTAGGED) return list.filter(item => item.tags.length === 0)
        return list.filter(item => item.tags.some(tag => isInCategory(tag, filterTag)))
    }, [items, filterTag])

    const list = useMemo(() => {
        const column = columns.find(c => c.key === sortKey) ?? columns[0]
        const direction = ascending ? 1 : -1
        return [...filtered].sort((a, b) => {
            const left = column.value(a)
            const right = column.value(b)
            const order = typeof left === "number" ? left - right : String(left).localeCompare(String(right))
            return order * direction
        })
    }, [filtered, columns, sortKey, ascending])

    /*
     * One group per category, in path order so a parent always precedes its
     * children, each holding only the items tagged with it exactly -- a nested
     * item belongs to its own group, not its parent's. A parent with no direct
     * items still gets a header when something in its subtree is showing, so
     * the tree never has a gap in the middle. An item in several categories
     * appears under each of them.
     */
    const groups = useMemo(() => {
        const nested = categories
            .filter(tag => list.some(item => item.tags.some(t => isInCategory(t, tag))))
            .map(tag => ({ tag, depth: categoryDepth(tag), members: list.filter(item => item.tags.includes(tag)) }))
        const untagged = list.filter(item => item.tags.length === 0)
        if (untagged.length > 0) nested.push({ tag: UNTAGGED, depth: 0, members: untagged })
        return nested
    }, [categories, list])

    const toggleGrouped = useCallback(checked => {
        setGrouped(checked)
        localStorage.setItem(groupedPrefKey, String(checked))
    }, [groupedPrefKey])

    const toggleSort = useCallback(key => {
        if (key === sortKey) setAscending(asc => !asc)
        else { setSortKey(key); setAscending(true) }
    }, [sortKey])

    return { filterTag, setFilterTag, grouped, toggleGrouped, sortKey, ascending, toggleSort, list, groups }
}

function CategoryToolbarControls({ categories, filterTag, onFilterChange, grouped, onGroupedChange }) {
    return (
        <>
            <select value={filterTag} onChange={e => onFilterChange(e.target.value)} title="Filter by category">
                <option value="">All categories</option>
                {categories.map(tag => (
                    <option value={tag} key={tag}>{`${"  ".repeat(categoryDepth(tag))}${categoryLeaf(tag)}`}</option>
                ))}
                <option value={UNTAGGED}>{UNTAGGED}</option>
            </select>
            <label className="diet-manager-toolbar-check">
                <input type="checkbox" checked={grouped} onChange={e => onGroupedChange(e.target.checked)} />
                <span>Group by category</span>
            </label>
        </>
    )
}

function ItemRows({ list, columns, onEdit, onDelete }) {
    return list.map(item => (
        <tr key={item.id}>
            {columns.map(column => <td key={column.key}>{column.render(item)}</td>)}
            <td className="diet-manager-cell-actions">
                <button className="diet-manager-action bx bx-edit" title="Edit" onClick={() => onEdit(item.id)} />
                <button className="diet-manager-action diet-manager-action-remove bx bx-trash" title="Delete" onClick={() => onDelete(item.id)} />
            </td>
        </tr>
    ))
}

function CategoryTable({ columns, view, onEdit, onDelete, emptyLabel }) {
    const { grouped, groups, list, sortKey, ascending, toggleSort } = view
    return (
        <table className="diet-manager-table">
            <thead>
                <tr>
                    {columns.map(column => (
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
            </thead>
            {grouped
                ? groups.map(({ tag, depth, members }) => (
                    <tbody key={tag}>
                        <tr className="diet-manager-group-row">
                            <th colSpan={columns.length + 1} style={{ paddingLeft: `${8 + depth * 20}px` }}>
                                {categoryLeaf(tag)} <span className="diet-manager-hint">({members.length})</span>
                            </th>
                        </tr>
                        <ItemRows list={members} columns={columns} onEdit={onEdit} onDelete={onDelete} />
                    </tbody>
                ))
                : <tbody><ItemRows list={list} columns={columns} onEdit={onEdit} onDelete={onDelete} /></tbody>}
            {list.length === 0 && (
                <tbody>
                    <tr><td colSpan={columns.length + 1} className="diet-manager-empty">{emptyLabel}</td></tr>
                </tbody>
            )}
        </table>
    )
}

function FoodsTab({ foods, categories, units, usdaApiKey, onSaveFood, onDeleteFood }) {
    const [editingId, setEditingId] = useState(null)
    const [adding, setAdding] = useState(false)
    const view = useCategoryView(foods, categories, FOOD_COLUMNS, "diet-manager-group-foods-by-category")

    if (adding) {
        return (
            <FoodForm
                usdaApiKey={usdaApiKey}
                tagSuggestions={categories}
                unitSuggestions={units}
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
                tagSuggestions={categories}
                unitSuggestions={units}
                onSave={food => { onSaveFood(food); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
            />
        )
    }

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <Button icon="bx-plus" text="Add Food" onClick={() => setAdding(true)} />
                <CategoryToolbarControls
                    categories={categories}
                    filterTag={view.filterTag}
                    onFilterChange={view.setFilterTag}
                    grouped={view.grouped}
                    onGroupedChange={view.toggleGrouped}
                />
            </div>
            <CategoryTable
                columns={FOOD_COLUMNS}
                view={view}
                onEdit={setEditingId}
                onDelete={onDeleteFood}
                emptyLabel={view.filterTag ? "No foods in this category." : "No foods yet."}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Recipes tab
// ---------------------------------------------------------------------------
function RecipeForm({ initial, foods, tagSuggestions, unitSuggestions, onSave, onCancel }) {
    const [recipe, setRecipe] = useState(() => normalizeRecipe(initial))
    const [tagDraft, setTagDraft] = useState("")
    const [addFoodId, setAddFoodId] = useState("")

    const foodList = useMemo(() => Object.values(foods).sort((a, b) => a.name.localeCompare(b.name)), [foods])
    const perServing = useMemo(() => recipeNutrientsPerServing(recipe, foods), [recipe, foods])

    const addIngredient = useCallback(() => {
        if (!addFoodId) return
        setRecipe(c => ({
            ...c,
            ingredients: [...c.ingredients, { foodId: addFoodId, amount: foods[addFoodId]?.servingSize ?? 1, unit: foods[addFoodId]?.servingUnit ?? "" }]
        }))
        setAddFoodId("")
    }, [addFoodId, foods])

    const updateIngredient = useCallback((index, changes) => {
        setRecipe(c => ({ ...c, ingredients: c.ingredients.map((ing, i) => i === index ? { ...ing, ...changes } : ing) }))
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
            <div className="diet-manager-field-row">
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
                <label className="diet-manager-field">
                    <span>Serving Unit</span>
                    <SuggestInput
                        value={recipe.servingUnit}
                        suggestions={unitSuggestions}
                        placeholder="serving, bowl, slice..."
                        onChange={unit => setRecipe(c => ({ ...c, servingUnit: unit }))}
                    />
                </label>
            </div>

            <TagEditor
                tags={recipe.tags}
                draft={tagDraft}
                suggestions={tagSuggestions}
                onChange={tags => setRecipe(c => ({ ...c, tags }))}
                onDraftChange={setTagDraft}
            />

            <h4>Ingredients</h4>
            <ul className="diet-manager-ingredient-list">
                {recipe.ingredients.map((ing, index) => (
                    <li key={index} className="diet-manager-ingredient-row">
                        <span className="diet-manager-ingredient-name">{foods[ing.foodId]?.name || "(deleted food)"}</span>
                        <input
                            type="number"
                            step="0.01"
                            value={ing.amount}
                            onInput={e => updateIngredient(index, { amount: parseFloat(e.target.value) || 0 })}
                        />
                        <FoodUnitSelect
                            food={foods[ing.foodId]}
                            value={ing.unit || foods[ing.foodId]?.servingUnit || ""}
                            onChange={unit => updateIngredient(index, { unit })}
                        />
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
                <Button
                    text="Save"
                    onClick={() => onSave({ ...recipe, tags: withDraftTag(recipe.tags, tagDraft) })}
                    disabled={!recipe.name.trim()}
                />
                <Button text="Cancel" onClick={onCancel} />
            </div>
        </div>
    )
}

function RecipesTab({ recipes, foods, categories, units, onSaveRecipe, onDeleteRecipe }) {
    const [editingId, setEditingId] = useState(null)
    const [adding, setAdding] = useState(false)

    // Per-serving figures depend on the foods, so the columns are built per render of that list.
    const columns = useMemo(() => [
        { key: "name", label: "Name", value: recipe => recipe.name, render: recipe => recipe.name },
        { key: "tags", label: "Categories", value: recipe => recipe.tags.join(", "), render: recipe => recipe.tags.join(", ") },
        { key: "servings", label: "Servings", value: recipe => recipe.servings, render: recipe => `${recipe.servings} ${recipe.servingUnit}` },
        {
            key: "calories",
            label: "Calories / serving",
            value: recipe => recipeNutrientsPerServing(recipe, foods).calories,
            render: recipe => recipeNutrientsPerServing(recipe, foods).calories.toFixed(0)
        },
        {
            key: "protein",
            label: "Protein / serving",
            value: recipe => recipeNutrientsPerServing(recipe, foods).protein,
            render: recipe => `${recipeNutrientsPerServing(recipe, foods).protein.toFixed(1)}g`
        }
    ], [foods])

    const view = useCategoryView(recipes, categories, columns, "diet-manager-group-recipes-by-category")

    if (adding) {
        return (
            <RecipeForm
                foods={foods}
                tagSuggestions={categories}
                unitSuggestions={units}
                onSave={recipe => { onSaveRecipe(recipe); setAdding(false) }}
                onCancel={() => setAdding(false)}
            />
        )
    }
    if (editingId) {
        return (
            <RecipeForm
                initial={recipes[editingId]}
                foods={foods}
                tagSuggestions={categories}
                unitSuggestions={units}
                onSave={recipe => { onSaveRecipe(recipe); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
            />
        )
    }

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <Button icon="bx-plus" text="Add Recipe" onClick={() => setAdding(true)} />
                <CategoryToolbarControls
                    categories={categories}
                    filterTag={view.filterTag}
                    onFilterChange={view.setFilterTag}
                    grouped={view.grouped}
                    onGroupedChange={view.toggleGrouped}
                />
            </div>
            <CategoryTable
                columns={columns}
                view={view}
                onEdit={setEditingId}
                onDelete={onDeleteRecipe}
                emptyLabel={view.filterTag ? "No recipes in this category." : "No recipes yet."}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Diary tab
// ---------------------------------------------------------------------------
function DiaryTab({ diary, foods, recipes, categories, settings, onAddEntry, onRemoveEntry }) {
    const [date, setDate] = useState(() => todayKey())
    const [kind, setKind] = useState("food")
    const [refId, setRefId] = useState("")
    const [servings, setServings] = useState(1)
    const [unit, setUnit] = useState(SERVING_UNIT)

    const entries = diary[date] || []
    const totals = useMemo(() => dayTotals(entries, foods, recipes), [entries, foods, recipes])

    const options = kind === "food" ? Object.values(foods) : Object.values(recipes)
    const sortedOptions = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options])

    // Foods are offered grouped by category; a food in several categories is listed under each.
    const foodGroups = useMemo(() => {
        if (kind !== "food") return []
        const groups = categories
            .map(tag => [tag, sortedOptions.filter(food => food.tags.includes(tag))])
            .filter(([, members]) => members.length > 0)
        const untagged = sortedOptions.filter(food => food.tags.length === 0)
        if (untagged.length > 0) groups.push([UNTAGGED, untagged])
        return groups
    }, [kind, categories, sortedOptions])

    const chooseRef = useCallback(id => {
        setRefId(id)
        setUnit(SERVING_UNIT)
    }, [])

    const addEntry = useCallback(() => {
        if (!refId) return
        onAddEntry(date, { kind, refId, servings, unit: kind === "food" ? unit : "" })
        setRefId("")
        setServings(1)
        setUnit(SERVING_UNIT)
    }, [date, kind, refId, servings, unit, onAddEntry])

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
                            <span className="diet-manager-diary-entry-servings">
                                {entry.unit ? `${entry.servings} ${entry.unit}` : `${entry.servings}x`}
                            </span>
                            <button className="diet-manager-action diet-manager-action-remove bx bx-trash" onClick={() => onRemoveEntry(date, entry.id)} />
                        </li>
                    )
                })}
                {entries.length === 0 && <li className="diet-manager-empty">Nothing logged for this day.</li>}
            </ul>

            <div className="diet-manager-add-ingredient">
                <select value={kind} onChange={e => { setKind(e.target.value); chooseRef("") }}>
                    <option value="food">Food</option>
                    <option value="recipe">Recipe</option>
                </select>
                <select value={refId} onChange={e => chooseRef(e.target.value)}>
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
                    title="Amount"
                />
                {kind === "food" && refId && (
                    <FoodUnitSelect food={foods[refId]} value={unit} title="Unit" onChange={setUnit} />
                )}
                <Button text="Log" onClick={addEntry} disabled={!refId} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Units tab — the unit vocabulary shared by foods, recipes and grocery lines:
// create, rename (across everything using it), and delete.
// ---------------------------------------------------------------------------
function UnitsTab({ database, units, onCreate, onRename, onDelete }) {
    const [draft, setDraft] = useState("")
    const [editing, setEditing] = useState(null)
    const [editDraft, setEditDraft] = useState("")

    const create = useCallback(() => {
        if (!draft.trim()) return
        onCreate(draft.trim())
        setDraft("")
    }, [draft, onCreate])

    const startRename = useCallback(unit => {
        setEditing(unit)
        setEditDraft(unit)
    }, [])

    const commitRename = useCallback(() => {
        const target = editDraft.trim()
        if (target && target !== editing) onRename(editing, target)
        setEditing(null)
    }, [editing, editDraft, onRename])

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <input
                    type="text"
                    className="diet-manager-category-new"
                    placeholder="New unit..."
                    value={draft}
                    onInput={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); create() } }}
                />
                <Button icon="bx-plus" text="Add Unit" onClick={create} disabled={!draft.trim()} />
            </div>
            <table className="diet-manager-table">
                <thead>
                    <tr>
                        <th>Unit</th>
                        <th>Foods</th>
                        <th>Recipes</th>
                        <th>Grocery</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {units.map(unit => {
                        const usage = unitUsage(database, unit)
                        return (
                            <tr key={unit}>
                                <td>
                                    {editing === unit
                                        ? <input
                                            type="text"
                                            value={editDraft}
                                            autoFocus
                                            onInput={e => setEditDraft(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={e => {
                                                if (e.key === "Enter") { e.preventDefault(); commitRename() }
                                                if (e.key === "Escape") setEditing(null)
                                            }}
                                        />
                                        : unit}
                                </td>
                                <td>{usage.foods}</td>
                                <td>{usage.recipes}</td>
                                <td>{usage.grocery}</td>
                                <td className="diet-manager-cell-actions">
                                    <button className="diet-manager-action bx bx-edit" title="Rename" onClick={() => startRename(unit)} />
                                    <button
                                        className="diet-manager-action diet-manager-action-remove bx bx-trash"
                                        title="Delete"
                                        onClick={() => onDelete(unit, usage)}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                    {units.length === 0 && <tr><td colSpan={5} className="diet-manager-empty">No units yet.</td></tr>}
                </tbody>
            </table>
            <p className="diet-manager-hint">
                Renaming updates every food, recipe and grocery line using the unit. Renaming onto an
                existing unit merges the two. A unit still in use cannot be deleted — rename it onto
                another unit first, which moves everything over.
            </p>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Grocery tab — a manually maintained shopping list of foods. Amounts are
// typed in, never derived from recipes or the diary, and each line keeps its
// own unit (prefilled from the food's serving unit, then editable).
// ---------------------------------------------------------------------------
function GroceryTab({ grocery, foods, categories, units, onAdd, onUpdate, onRemove, onClearDone }) {
    const [foodId, setFoodId] = useState("")
    const [amount, setAmount] = useState(1)
    const [unit, setUnit] = useState("")
    const [grouped, setGrouped] = useState(() => localStorage.getItem(GROCERY_GROUPED_PREF_KEY) === "true")

    const foodList = useMemo(() => Object.values(foods).sort((a, b) => a.name.localeCompare(b.name)), [foods])
    const doneCount = grocery.filter(item => item.done).length

    // Picking a food offers its own serving unit until the unit is typed over.
    const chooseFood = useCallback(id => {
        setFoodId(id)
        setUnit(foods[id]?.servingUnit || "")
    }, [foods])

    const add = useCallback(() => {
        if (!foodId) return
        onAdd({ foodId, amount, unit })
        setFoodId("")
        setAmount(1)
        setUnit("")
    }, [foodId, amount, unit, onAdd])

    const toggleGrouped = useCallback(checked => {
        setGrouped(checked)
        localStorage.setItem(GROCERY_GROUPED_PREF_KEY, String(checked))
    }, [])

    // Lines grouped by their food's categories, in the same tree order the other
    // tabs use; a line whose food is in several categories shows under each.
    const groups = useMemo(() => {
        const tagsOf = item => foods[item.foodId]?.tags ?? []
        const nested = categories
            .filter(tag => grocery.some(item => tagsOf(item).some(t => isInCategory(t, tag))))
            .map(tag => ({ tag, depth: categoryDepth(tag), members: grocery.filter(item => tagsOf(item).includes(tag)) }))
        const untagged = grocery.filter(item => tagsOf(item).length === 0)
        if (untagged.length > 0) nested.push({ tag: UNTAGGED, depth: 0, members: untagged })
        return nested
    }, [grocery, foods, categories])

    // A line's own unit picker also offers whatever units its food defines.
    const unitsFor = useCallback(item => {
        const food = foods[item.foodId]
        return food ? normalizeUnits([...units, ...foodUnits(food).map(u => u.unit)]) : units
    }, [foods, units])

    const renderRow = item => (
        <li key={item.id} className={item.done ? "diet-manager-grocery-row diet-manager-grocery-done" : "diet-manager-grocery-row"}>
            <input
                type="checkbox"
                checked={item.done}
                title="Bought"
                onChange={e => onUpdate(item.id, { done: e.target.checked })}
            />
            <span className="diet-manager-grocery-name">{foods[item.foodId]?.name || "(deleted food)"}</span>
            <input
                type="number"
                step="0.01"
                min="0.01"
                value={item.amount}
                onInput={e => onUpdate(item.id, { amount: parseFloat(e.target.value) || 0 })}
            />
            <SuggestInput
                className="diet-manager-suggest-unit"
                value={item.unit}
                suggestions={unitsFor(item)}
                onChange={value => onUpdate(item.id, { unit: value })}
            />
            <button className="diet-manager-action diet-manager-action-remove bx bx-trash" title="Remove" onClick={() => onRemove(item.id)} />
        </li>
    )

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <select value={foodId} onChange={e => chooseFood(e.target.value)}>
                    <option value="">Select food...</option>
                    {foodList.map(food => <option value={food.id} key={food.id}>{food.name}</option>)}
                </select>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onInput={e => setAmount(parseFloat(e.target.value) || 1)}
                    title="Amount"
                />
                <SuggestInput
                    className="diet-manager-suggest-unit"
                    placeholder="Unit"
                    value={unit}
                    suggestions={foodId && foods[foodId] ? normalizeUnits([...units, ...foodUnits(foods[foodId]).map(u => u.unit)]) : units}
                    onChange={setUnit}
                    onCommit={add}
                />
                <Button icon="bx-plus" text="Add" onClick={add} disabled={!foodId} />
                <label className="diet-manager-toolbar-check">
                    <input type="checkbox" checked={grouped} onChange={e => toggleGrouped(e.target.checked)} />
                    <span>Group by category</span>
                </label>
                <span className="diet-manager-tabs-spacer" />
                <Button text={`Clear Checked (${doneCount})`} onClick={onClearDone} disabled={doneCount === 0} />
            </div>
            {grouped
                ? groups.map(({ tag, depth, members }) => (
                    <div key={tag}>
                        <h4 className="diet-manager-grocery-group" style={{ paddingLeft: `${depth * 20}px` }}>
                            {categoryLeaf(tag)} <span className="diet-manager-hint">({members.length})</span>
                        </h4>
                        <ul className="diet-manager-grocery-list">{members.map(renderRow)}</ul>
                    </div>
                ))
                : <ul className="diet-manager-grocery-list">{grocery.map(renderRow)}</ul>}
            {grocery.length === 0 && <p className="diet-manager-empty">Nothing on the list.</p>}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Categories tab — the category tree itself: create (optionally inside a
// parent), rename across every food and recipe at once, and delete.
// ---------------------------------------------------------------------------
function CategoriesTab({ database, categories, onCreate, onRename, onDelete }) {
    const [draft, setDraft] = useState("")
    const [parent, setParent] = useState("")
    const [editing, setEditing] = useState(null)
    const [editDraft, setEditDraft] = useState("")

    const create = useCallback(() => {
        const name = normalizeCategoryName(parent ? `${parent}${CATEGORY_SEPARATOR}${draft}` : draft)
        if (!name) return
        onCreate(name)
        setDraft("")
    }, [draft, parent, onCreate])

    const startRename = useCallback(name => {
        setEditing(name)
        setEditDraft(name)
    }, [])

    const commitRename = useCallback(() => {
        const target = normalizeCategoryName(editDraft)
        if (target && target !== editing) onRename(editing, target)
        setEditing(null)
    }, [editing, editDraft, onRename])

    return (
        <div className="diet-manager-tab">
            <div className="diet-manager-toolbar">
                <select value={parent} onChange={e => setParent(e.target.value)} title="Parent category">
                    <option value="">(top level)</option>
                    {categories.map(tag => (
                        <option value={tag} key={tag}>{`${"  ".repeat(categoryDepth(tag))}${categoryLeaf(tag)}`}</option>
                    ))}
                </select>
                <input
                    type="text"
                    className="diet-manager-category-new"
                    placeholder="New category..."
                    value={draft}
                    onInput={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); create() } }}
                />
                <Button icon="bx-plus" text="Add Category" onClick={create} disabled={!draft.trim()} />
            </div>
            <table className="diet-manager-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Foods</th>
                        <th>Recipes</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {categories.map(name => {
                        const direct = categoryUsage(database, name)
                        const subtree = categoryUsage(database, name, true)
                        const nested = subtree.foods > direct.foods || subtree.recipes > direct.recipes
                        return (
                            <tr key={name}>
                                <td style={{ paddingLeft: `${8 + categoryDepth(name) * 20}px` }}>
                                    {editing === name
                                        ? <input
                                            type="text"
                                            value={editDraft}
                                            autoFocus
                                            onInput={e => setEditDraft(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={e => {
                                                if (e.key === "Enter") { e.preventDefault(); commitRename() }
                                                if (e.key === "Escape") setEditing(null)
                                            }}
                                        />
                                        : categoryLeaf(name)}
                                </td>
                                <td>{direct.foods}{nested && <span className="diet-manager-hint"> ({subtree.foods} with nested)</span>}</td>
                                <td>{direct.recipes}{nested && <span className="diet-manager-hint"> ({subtree.recipes} with nested)</span>}</td>
                                <td className="diet-manager-cell-actions">
                                    <button className="diet-manager-action bx bx-edit" title="Rename or move" onClick={() => startRename(name)} />
                                    <button
                                        className="diet-manager-action diet-manager-action-remove bx bx-trash"
                                        title="Delete"
                                        onClick={() => onDelete(name, subtree)}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                    {categories.length === 0 && <tr><td colSpan={4} className="diet-manager-empty">No categories yet.</td></tr>}
                </tbody>
            </table>
            <p className="diet-manager-hint">
                Renaming edits the full path, so it also moves a category and everything nested under it:
                renaming "Protein" to "Macros/Protein" carries "Protein/Meat" along. Renaming onto an
                existing category merges the two. Deleting removes the category and its subcategories from
                every food and recipe; the foods and recipes themselves are kept.
            </p>
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
    // Mirrors `database` so persist can apply its updater without reading state
    // through a stale closure -- what gets written must be the object itself.
    const databaseRef = useRef(null)

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

    const onCreateCategory = useCallback(name => {
        persist(current => addCategory(current, name))
    }, [persist])

    const onRenameCategory = useCallback((from, to) => {
        persist(current => renameCategory(current, from, to))
    }, [persist])

    // `usage` counts the whole subtree, since deleting takes subcategories with it.
    const onDeleteCategory = useCallback((name, usage) => {
        const affected = usage.foods + usage.recipes > 0
            ? ` It is removed from ${usage.foods} food(s) and ${usage.recipes} recipe(s), including any subcategories.`
            : " Any subcategories go with it."
        if (!confirm(`Delete category "${name}"?${affected} The foods and recipes themselves are kept.`)) return
        persist(current => deleteCategory(current, name))
    }, [persist])

    const onCreateUnit = useCallback(name => {
        persist(current => addUnit(current, name))
    }, [persist])

    const onRenameUnit = useCallback((from, to) => {
        persist(current => renameUnit(current, from, to))
    }, [persist])

    // A unit in use has to stay: the records carrying it must keep some unit,
    // and the list would show it again anyway since it unions with what is used.
    const onDeleteUnit = useCallback((name, usage) => {
        const total = usage.foods + usage.recipes + usage.grocery
        if (total > 0) {
            api.showError(
                `"${name}" is still used by ${usage.foods} food(s), ${usage.recipes} recipe(s) and ${usage.grocery} grocery line(s). ` +
                "Rename it onto another unit to move them over, then delete it."
            )
            return
        }
        persist(current => deleteUnit(current, name))
    }, [persist])

    const onAddGrocery = useCallback(fields => {
        persist(current => ({
            ...current,
            grocery: [...current.grocery, normalizeGroceryItem({ ...fields, id: newId() }, current.foods)]
        }))
    }, [persist])

    const onUpdateGrocery = useCallback((id, changes) => {
        persist(current => ({
            ...current,
            grocery: current.grocery.map(item => item.id === id ? { ...item, ...changes } : item)
        }))
    }, [persist])

    const onRemoveGrocery = useCallback(id => {
        persist(current => ({ ...current, grocery: current.grocery.filter(item => item.id !== id) }))
    }, [persist])

    const onClearDoneGrocery = useCallback(() => {
        persist(current => ({ ...current, grocery: current.grocery.filter(item => !item.done) }))
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
                const groceryIds = new Set(current.grocery.map(item => item.id))
                return {
                    categories: normalizeTags([...current.categories, ...imported.categories]),
                    units: normalizeUnits([...current.units, ...imported.units]),
                    foods: { ...current.foods, ...imported.foods },
                    recipes: { ...current.recipes, ...imported.recipes },
                    diary,
                    grocery: [...current.grocery, ...imported.grocery.filter(item => !groceryIds.has(item.id))]
                }
            })
            api.showMessage(
                `Imported ${Object.keys(imported.foods).length} food(s) and ${Object.keys(imported.recipes).length} recipe(s).`
            )
        }
        input.click()
    }, [persist])

    const categories = useMemo(() => database ? allCategories(database) : [], [database])
    const units = useMemo(() => database ? allUnits(database) : [], [database])

    if (!database || !settings) return <div className="diet-manager-widget">Loading...</div>

    return (
        <div className="diet-manager-widget">
            <div className="diet-manager-tabs">
                <button className={tab === "diary" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("diary")}>Diary</button>
                <button className={tab === "recipes" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("recipes")}>Recipes</button>
                <button className={tab === "foods" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("foods")}>Foods</button>
                <button className={tab === "grocery" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("grocery")}>Grocery</button>
                <button className={tab === "categories" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("categories")}>Categories</button>
                <button className={tab === "units" ? "diet-manager-tab-btn diet-manager-tab-btn-active" : "diet-manager-tab-btn"} onClick={() => setTab("units")}>Units</button>
                <span className="diet-manager-tabs-spacer" />
                <Button icon="bx-import" text="Import JSON" onClick={onImport} />
                <Button icon="bx-export" text="Export JSON" onClick={onExport} />
            </div>
            {tab === "diary" && (
                <DiaryTab
                    diary={database.diary}
                    foods={database.foods}
                    recipes={database.recipes}
                    categories={categories}
                    settings={settings}
                    onAddEntry={onAddEntry}
                    onRemoveEntry={onRemoveEntry}
                />
            )}
            {tab === "foods" && (
                <FoodsTab
                    foods={database.foods}
                    categories={categories}
                    units={units}
                    usdaApiKey={settings.usdaApiKey}
                    onSaveFood={onSaveFood}
                    onDeleteFood={onDeleteFood}
                />
            )}
            {tab === "recipes" && (
                <RecipesTab
                    recipes={database.recipes}
                    foods={database.foods}
                    categories={categories}
                    units={units}
                    onSaveRecipe={onSaveRecipe}
                    onDeleteRecipe={onDeleteRecipe}
                />
            )}
            {tab === "units" && (
                <UnitsTab
                    database={database}
                    units={units}
                    onCreate={onCreateUnit}
                    onRename={onRenameUnit}
                    onDelete={onDeleteUnit}
                />
            )}
            {tab === "grocery" && (
                <GroceryTab
                    grocery={database.grocery}
                    foods={database.foods}
                    categories={categories}
                    units={units}
                    onAdd={onAddGrocery}
                    onUpdate={onUpdateGrocery}
                    onRemove={onRemoveGrocery}
                    onClearDone={onClearDoneGrocery}
                />
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

export default DietManagerWidget
