/*
 * Recipes data model. Pure functions over the JSON document stored in the
 * addon's persisted Database note:
 *   {
 *     foods: { [id]: { id, name, servingSize, servingUnit, nutrients: {...} } },
 *     recipes: { [id]: { id, name, servings, ingredients: [{ foodId, amount }] } },
 *     diary: { [date]: [{ id, kind: "food"|"recipe", refId, servings, loggedAt }] }
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

function normalizeFood(food) {
    return {
        id: typeof food?.id === "string" && food.id ? food.id : newId(),
        name: typeof food?.name === "string" ? food.name : "",
        servingSize: Number.isFinite(Number(food?.servingSize)) ? Number(food.servingSize) : 100,
        servingUnit: typeof food?.servingUnit === "string" && food.servingUnit ? food.servingUnit : "g",
        nutrients: normalizeNutrients(food?.nutrients)
    }
}

function normalizeIngredient(ingredient) {
    const amount = Number(ingredient?.amount)
    return {
        foodId: typeof ingredient?.foodId === "string" ? ingredient.foodId : "",
        amount: Number.isFinite(amount) && amount > 0 ? amount : 1
    }
}

function normalizeRecipe(recipe) {
    const servings = Number(recipe?.servings)
    return {
        id: typeof recipe?.id === "string" && recipe.id ? recipe.id : newId(),
        name: typeof recipe?.name === "string" ? recipe.name : "",
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        ingredients: Array.isArray(recipe?.ingredients) ? recipe.ingredients.map(normalizeIngredient) : []
    }
}

function normalizeDiaryEntry(entry) {
    const servings = Number(entry?.servings)
    return {
        id: typeof entry?.id === "string" && entry.id ? entry.id : newId(),
        kind: entry?.kind === "recipe" ? "recipe" : "food",
        refId: typeof entry?.refId === "string" ? entry.refId : "",
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
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
    return { foods, recipes, diary }
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
        const multiplier = ingredient.amount / food.servingSize
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
        const scaled = emptyNutrients()
        for (const n of NUTRIENTS) scaled[n.key] = food.nutrients[n.key] * entry.servings
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
    normalizeFood,
    normalizeRecipe,
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
