/*
 * Diet Manager data model. Pure functions over the JSON document stored in the
 * addon's persisted Database note:
 *   {
 *     categories: [ "Dairy", "Protein/Meat", ... ],
 *     units: [ "g", "cup", ... ],
 *     foods: { [id]: { id, name, servingSize, servingUnit, portions: [{ unit, size }], tags: [...], nutrients: {...} } },
 *     recipes: { [id]: { id, name, servings, servingUnit, tags: [...], ingredients: [{ foodId, amount, unit }] } },
 *     diary: { [date]: [{ id, kind: "food"|"recipe", refId, servings, unit, loggedAt }] },
 *     grocery: [ { id, foodId, amount, unit, comment, done } ]
 *   }
 * `date` is an ISO "YYYY-MM-DD" string. All nutrient values are per the food's
 * own serving (servingSize/servingUnit), same convention Cronometer uses.
 */

const NUTRIENTS = [
    { key: "calories", label: "Calories", unit: "kcal" },
    { key: "protein", label: "Protein", unit: "g" },
    { key: "carbs", label: "Carbs", unit: "g" },
    { key: "fat", label: "Fat", unit: "g" },
    { key: "fiber", label: "Fiber", unit: "g" },
    { key: "sugar", label: "Sugar", unit: "g" },
    { key: "saturatedFat", label: "Saturated Fat", unit: "g" },
    { key: "sodium", label: "Sodium", unit: "mg" },
    { key: "cholesterol", label: "Cholesterol", unit: "mg" }
]

function newId() {
    return Math.random().toString(36).slice(2, 10)
}

function emptyNutrients() {
    const nutrients = {}
    for (const n of NUTRIENTS) nutrients[n.key] = 0
    return nutrients
}

function normalizeNutrients(raw) {
    const nutrients = emptyNutrients()
    for (const n of NUTRIENTS) {
        const value = Number(raw?.[n.key])
        nutrients[n.key] = Number.isFinite(value) ? value : 0
    }
    return nutrients
}

/*
 * Categories nest by path: "Protein/Meat/Poultry" is Poultry inside Meat inside
 * Protein. The path string is the whole identity -- there are no category
 * records to keep in step with it -- so a flat name is simply a depth-1 path
 * and every older database is already valid.
 */
const CATEGORY_SEPARATOR = "/"

function normalizeCategoryName(raw) {
    if (typeof raw !== "string") return ""
    return raw.split(CATEGORY_SEPARATOR).map(segment => segment.trim()).filter(Boolean).join(CATEGORY_SEPARATOR)
}

// Category tags: path-normalized, de-duplicated case-insensitively, kept in
// sorted order -- which also puts every parent directly before its children.
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

/*
 * A portion is an alternative way to measure one food: `size` is how much of
 * the food's own serving unit one of them is, so a tortilla whose nutrition is
 * recorded per 100 g gets { unit: "tortilla", size: 100 } if one tortilla
 * weighs 100 g. Nutrition is still stored once, per the base serving; portions
 * only ever convert an amount into that base.
 */
function normalizePortion(portion) {
    const size = Number(portion?.size)
    return {
        unit: typeof portion?.unit === "string" ? portion.unit.trim() : "",
        size: Number.isFinite(size) && size > 0 ? size : 1
    }
}

function normalizePortions(raw) {
    if (!Array.isArray(raw)) return []
    const byUnit = new Map()
    for (const portion of raw) {
        const normalized = normalizePortion(portion)
        if (normalized.unit) byUnit.set(normalized.unit.toLowerCase(), normalized)
    }
    return [...byUnit.values()]
}

function normalizeFood(food) {
    return {
        id: typeof food?.id === "string" && food.id ? food.id : newId(),
        name: typeof food?.name === "string" ? food.name : "",
        servingSize: Number.isFinite(Number(food?.servingSize)) ? Number(food.servingSize) : 100,
        servingUnit: typeof food?.servingUnit === "string" && food.servingUnit ? food.servingUnit : "g",
        portions: normalizePortions(food?.portions),
        tags: normalizeTags(food?.tags),
        nutrients: normalizeNutrients(food?.nutrients)
    }
}

/*
 * Every way this food can be measured, as { unit, size } where size is that
 * unit expressed in the food's serving unit: one whole serving, one of the
 * serving unit itself, then each portion. Amount x size / servingSize is the
 * multiplier to apply to the stored nutrients.
 */
const SERVING_UNIT = "serving"

function foodUnits(food) {
    const units = [{ unit: SERVING_UNIT, size: food.servingSize }]
    if (food.servingUnit !== SERVING_UNIT) units.push({ unit: food.servingUnit, size: 1 })
    for (const portion of food.portions) {
        if (portion.unit !== SERVING_UNIT && portion.unit !== food.servingUnit) units.push(portion)
    }
    return units
}

// How much of the food's serving unit one `unit` is; unknown units fall back to `fallback`.
function unitSize(food, unit, fallback) {
    const match = foodUnits(food).find(entry => entry.unit === unit)
    return match ? match.size : fallback
}

// Multiplier to apply to a food's stored (per-serving) nutrients for `amount` of `unit`.
function servingsFor(food, amount, unit, fallbackUnit) {
    const size = unitSize(food, unit || fallbackUnit, unitSize(food, fallbackUnit, 1))
    return (amount * size) / food.servingSize
}

// Foods and recipes are both taggable and are treated alike wherever categories are concerned.
function taggedItems(database) {
    return [...Object.values(database.foods), ...Object.values(database.recipes)]
}

/*
 * The category list is the union of the explicitly managed `categories` array,
 * whatever tags items actually carry, and every ancestor those paths imply. So
 * a category created but not yet used still shows up, a tag that only exists on
 * an item is never hidden, and tagging something "A/B" makes "A" exist too.
 */
function allCategories(database) {
    const used = [...database.categories, ...taggedItems(database).flatMap(item => item.tags)]
    return normalizeTags(used.flatMap(name => [name, ...categoryAncestors(name)]))
}

// Items tagged with this exact category, and (with descendants) its whole subtree.
function categoryUsage(database, name, includeDescendants = false) {
    const matches = tags => includeDescendants ? tags.some(tag => isInCategory(tag, name)) : tags.includes(name)
    return {
        foods: Object.values(database.foods).filter(food => matches(food.tags)).length,
        recipes: Object.values(database.recipes).filter(recipe => matches(recipe.tags)).length
    }
}

function addCategory(database, name) {
    return { ...database, categories: normalizeTags([...database.categories, name]) }
}

// Maps every tag of every food and recipe, then rebuilds both collections.
function mapItemTags(database, mapTags) {
    const remap = collection => {
        const next = {}
        for (const [id, item] of Object.entries(collection)) next[id] = { ...item, tags: normalizeTags(mapTags(item.tags)) }
        return next
    }
    return { ...database, foods: remap(database.foods), recipes: remap(database.recipes) }
}

/*
 * Renaming moves the subtree with it: renaming "Protein" to "Macros/Protein"
 * takes "Protein/Meat" along as "Macros/Protein/Meat". Renaming onto a name
 * that already exists merges the two, since normalizeTags drops the duplicate.
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

// An ingredient with no unit is an amount in the food's serving unit, which is what it always meant.
function normalizeIngredient(ingredient) {
    const amount = Number(ingredient?.amount)
    return {
        foodId: typeof ingredient?.foodId === "string" ? ingredient.foodId : "",
        amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
        unit: typeof ingredient?.unit === "string" ? ingredient.unit.trim() : ""
    }
}

function normalizeUnit(raw, fallback) {
    const trimmed = typeof raw === "string" ? raw.trim() : ""
    return trimmed || fallback
}

// A recipe's unit names what one serving is: a bowl, a slice, a portion.
function normalizeRecipe(recipe) {
    const servings = Number(recipe?.servings)
    return {
        id: typeof recipe?.id === "string" && recipe.id ? recipe.id : newId(),
        name: typeof recipe?.name === "string" ? recipe.name : "",
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        servingUnit: normalizeUnit(recipe?.servingUnit, "serving"),
        tags: normalizeTags(recipe?.tags),
        ingredients: Array.isArray(recipe?.ingredients) ? recipe.ingredients.map(normalizeIngredient) : []
    }
}

/*
 * Grocery list: a flat, manually maintained shopping list of foods. Amounts are
 * typed in rather than derived from recipes or the diary, and each line carries
 * its own unit so "2 loaf" and "500 g" can both be shopping-list amounts for a
 * food whose nutrition serving is 100 g.
 */
function normalizeGroceryItem(item, foods = {}) {
    const amount = Number(item?.amount)
    const foodId = typeof item?.foodId === "string" ? item.foodId : ""
    return {
        id: typeof item?.id === "string" && item.id ? item.id : newId(),
        foodId,
        amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
        unit: normalizeUnit(item?.unit, foods[foodId]?.servingUnit || "g"),
        comment: typeof item?.comment === "string" ? item.comment : "",
        done: item?.done === true
    }
}

// Units: trimmed, de-duplicated case-insensitively, kept in sorted order.
function normalizeUnits(raw) {
    if (!Array.isArray(raw)) return []
    const byLower = new Map()
    for (const unit of raw) {
        const trimmed = typeof unit === "string" ? unit.trim() : ""
        if (trimmed && !byLower.has(trimmed.toLowerCase())) byLower.set(trimmed.toLowerCase(), trimmed)
    }
    return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

/*
 * The unit list is the union of the managed `units` array and every unit in
 * actual use, on the same principle as the category list: a unit created but
 * not yet used still shows up, and a unit typed straight into a form is never
 * hidden. Foods, recipes and grocery lines share one vocabulary.
 */
function unitsInUse(database) {
    return [
        ...Object.values(database.foods).map(food => food.servingUnit),
        ...Object.values(database.recipes).map(recipe => recipe.servingUnit),
        ...database.grocery.map(item => item.unit)
    ]
}

function allUnits(database) {
    return normalizeUnits([...database.units, ...unitsInUse(database)])
}

function unitUsage(database, unit) {
    return {
        foods: Object.values(database.foods).filter(food => food.servingUnit === unit).length,
        recipes: Object.values(database.recipes).filter(recipe => recipe.servingUnit === unit).length,
        grocery: database.grocery.filter(item => item.unit === unit).length
    }
}

function addUnit(database, name) {
    return { ...database, units: normalizeUnits([...database.units, name]) }
}

// Renaming rewrites every food, recipe and grocery line using the unit; renaming onto an existing unit merges the two.
function renameUnit(database, from, to) {
    const target = typeof to === "string" ? to.trim() : ""
    if (!target) return database
    const swap = unit => unit === from ? target : unit
    const foods = {}
    for (const [id, food] of Object.entries(database.foods)) foods[id] = { ...food, servingUnit: swap(food.servingUnit) }
    const recipes = {}
    for (const [id, recipe] of Object.entries(database.recipes)) recipes[id] = { ...recipe, servingUnit: swap(recipe.servingUnit) }
    return {
        ...database,
        units: normalizeUnits(database.units.map(swap)),
        foods,
        recipes,
        grocery: database.grocery.map(item => ({ ...item, unit: swap(item.unit) }))
    }
}

/*
 * Deleting only drops the unit from the managed list. A unit still on a food,
 * recipe or grocery line would reappear in the list immediately (it is a union
 * with what is in use) and those records must keep some unit, so the caller
 * checks unitUsage first and offers a rename-into-another-unit instead.
 */
function deleteUnit(database, name) {
    return { ...database, units: database.units.filter(unit => unit !== name) }
}

function normalizeDiaryEntry(entry) {
    const servings = Number(entry?.servings)
    return {
        id: typeof entry?.id === "string" && entry.id ? entry.id : newId(),
        kind: entry?.kind === "recipe" ? "recipe" : "food",
        refId: typeof entry?.refId === "string" ? entry.refId : "",
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        // No unit means `servings` counts whole servings, which is what every entry meant before units.
        unit: typeof entry?.unit === "string" ? entry.unit.trim() : "",
        loggedAt: typeof entry?.loggedAt === "string" ? entry.loggedAt : new Date().toISOString()
    }
}

/*
 * The Database note is a JSON code note (never touched by the text editor),
 * so its content is raw JSON. Unparseable content becomes an empty database
 * rather than throwing in the widget's render path.
 */
function parseDatabase(content) {
    let parsed = null
    try {
        parsed = content ? JSON.parse(String(content).trim()) : null
    } catch {
        parsed = null
    }
    const foods = {}
    if (parsed?.foods && typeof parsed.foods === "object") {
        for (const [id, food] of Object.entries(parsed.foods)) foods[id] = { ...normalizeFood(food), id }
    }
    const recipes = {}
    if (parsed?.recipes && typeof parsed.recipes === "object") {
        for (const [id, recipe] of Object.entries(parsed.recipes)) recipes[id] = { ...normalizeRecipe(recipe), id }
    }
    const diary = {}
    if (parsed?.diary && typeof parsed.diary === "object") {
        for (const [date, entries] of Object.entries(parsed.diary)) {
            if (Array.isArray(entries)) diary[date] = entries.map(normalizeDiaryEntry)
        }
    }
    const grocery = Array.isArray(parsed?.grocery) ? parsed.grocery.map(item => normalizeGroceryItem(item, foods)) : []
    return {
        categories: normalizeTags(parsed?.categories),
        units: normalizeUnits(parsed?.units),
        foods,
        recipes,
        diary,
        grocery
    }
}

function serializeDatabase(database) {
    return JSON.stringify(database, null, 4)
}

// Per-serving nutrients for a recipe, derived from its ingredients (never stored).
function recipeNutrientsPerServing(recipe, foods) {
    const totals = emptyNutrients()
    for (const ingredient of recipe.ingredients) {
        const food = foods[ingredient.foodId]
        if (!food) continue
        const multiplier = servingsFor(food, ingredient.amount, ingredient.unit, food.servingUnit)
        for (const n of NUTRIENTS) totals[n.key] += food.nutrients[n.key] * multiplier
    }
    const perServing = emptyNutrients()
    for (const n of NUTRIENTS) perServing[n.key] = totals[n.key] / recipe.servings
    return perServing
}

// Nutrients contributed by one diary entry (already scaled by its servings).
function entryNutrients(entry, foods, recipes) {
    if (entry.kind === "food") {
        const food = foods[entry.refId]
        if (!food) return emptyNutrients()
        const multiplier = servingsFor(food, entry.servings, entry.unit, SERVING_UNIT)
        const scaled = emptyNutrients()
        for (const n of NUTRIENTS) scaled[n.key] = food.nutrients[n.key] * multiplier
        return scaled
    }
    const recipe = recipes[entry.refId]
    if (!recipe) return emptyNutrients()
    const perServing = recipeNutrientsPerServing(recipe, foods)
    const scaled = emptyNutrients()
    for (const n of NUTRIENTS) scaled[n.key] = perServing[n.key] * entry.servings
    return scaled
}

function dayTotals(entries, foods, recipes) {
    const totals = emptyNutrients()
    for (const entry of entries) {
        const contribution = entryNutrients(entry, foods, recipes)
        for (const n of NUTRIENTS) totals[n.key] += contribution[n.key]
    }
    return totals
}

// Nutrient key -> its "targetX" key in schema.json/config.json.
function targetKeyFor(nutrientKey) {
    return `target${nutrientKey[0].toUpperCase()}${nutrientKey.slice(1)}`
}

function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10)
}

function shiftDateKey(dateKey, deltaDays) {
    const date = new Date(`${dateKey}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + deltaDays)
    return date.toISOString().slice(0, 10)
}

function exportDatabase(database) {
    return serializeDatabase(database)
}

/*
 * Import accepts the same document shape serializeDatabase writes: a plain
 * object with optional foods/recipes/diary keys, each in the same shape
 * parseDatabase produces. Ids are preserved rather than regenerated (unlike
 * budget@beatlink's row import) since foods/recipes are referenced by id from
 * recipes/diary entries within the same document -- regenerating them would
 * require rewriting every reference. Throws on anything that isn't
 * recognisably a database so the caller can report it rather than silently
 * wiping existing data.
 */
function importDatabase(text) {
    let parsed
    try {
        parsed = JSON.parse(String(text).trim())
    } catch {
        throw new Error("Not valid JSON.")
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object with foods/recipes/diary.")
    }
    return parseDatabase(JSON.stringify(parsed))
}

module.exports = {
    NUTRIENTS,
    newId,
    emptyNutrients,
    normalizeTags,
    normalizeCategoryName,
    normalizeFood,
    SERVING_UNIT,
    foodUnits,
    unitSize,
    servingsFor,
    CATEGORY_SEPARATOR,
    categoryDepth,
    categoryLeaf,
    categoryAncestors,
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
    entryNutrients,
    dayTotals,
    targetKeyFor,
    todayKey,
    shiftDateKey,
    exportDatabase,
    importDatabase
}
