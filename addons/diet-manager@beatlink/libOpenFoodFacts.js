/*
 * Open Food Facts lookup, run entirely on the backend (the frontend webview's
 * CSP blocks direct fetch() to external hosts). No API key required — this
 * is a public, keyless search endpoint. Helper functions are declared inside
 * the runAsyncOnBackendWithManualTransactionHandling callback itself, since
 * it crosses a serialization boundary and can't close over outer-scope
 * functions — only over the arguments array passed as its 2nd param.
 */

// Open Food Facts nutriment keys (per 100g/100ml, "_100g" suffix regardless
// of whether the product is measured by weight or volume) mapped to our
// nutrient keys.
const OFF_NUTRIMENT_KEYS = {
    calories: "energy-kcal_100g",
    protein: "proteins_100g",
    carbs: "carbohydrates_100g",
    fat: "fat_100g",
    fiber: "fiber_100g",
    sugar: "sugars_100g",
    saturatedFat: "saturated-fat_100g",
    sodium: "sodium_100g",
    cholesterol: "cholesterol_100g"
}

async function searchFoods(query) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (query, nutrimentKeys) => {
        async function fetchJson(url) {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`Open Food Facts request failed: ${response.status} ${response.statusText}`)
            return await response.json()
        }

        const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=15`
        const results = await fetchJson(searchUrl)

        function extractNutrients(nutriments) {
            const nutrients = {}
            for (const [key, nutrimentKey] of Object.entries(nutrimentKeys)) {
                const value = nutriments?.[nutrimentKey]
                // Sodium is reported in grams per 100g by Open Food Facts, unlike
                // every other nutrient here — convert to mg to match our schema.
                const scaled = key === "sodium" ? Number(value) * 1000 : Number(value)
                nutrients[key] = Number.isFinite(scaled) ? scaled : 0
            }
            return nutrients
        }

        return (results.products || [])
            .filter(product => product.product_name)
            .map(product => ({
                code: product.code,
                name: product.product_name,
                servingSize: 100,
                servingUnit: "g",
                nutrients: extractNutrients(product.nutriments)
            }))
    }, [query, OFF_NUTRIMENT_KEYS])
}

module.exports = { searchFoods }
