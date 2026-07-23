/*
 * USDA FoodData Central lookup, run entirely on the backend (the frontend
 * webview's CSP blocks direct fetch() to external hosts). Helper functions are
 * declared inside the runAsyncOnBackendWithManualTransactionHandling callback
 * itself, since it crosses a serialization boundary and can't close over
 * outer-scope functions — only over the arguments array passed as its 2nd param.
 */

// FDC nutrient numbers (per 100g in `foodNutrients[].nutrientNumber`) mapped to our nutrient keys.
const FDC_NUTRIENT_NUMBERS = {
    calories: "208",
    protein: "203",
    carbs: "205",
    fat: "204",
    fiber: "291",
    sugar: "269",
    saturatedFat: "606",
    sodium: "307",
    cholesterol: "601"
}

async function searchFoods(apiKey, query) {
    if (!apiKey) throw new Error("No USDA API key configured. Set one in Recipes settings.")
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (apiKey, query, nutrientNumbers) => {
        async function fetchJson(url) {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`USDA API request failed: ${response.status} ${response.statusText}`)
            return await response.json()
        }

        const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=15&dataType=Foundation,SR%20Legacy,Branded`
        const results = await fetchJson(searchUrl)

        function extractNutrients(food) {
            const nutrients = {}
            for (const [key, number] of Object.entries(nutrientNumbers)) {
                const match = (food.foodNutrients || []).find(n => String(n.nutrientNumber) === number)
                nutrients[key] = match ? Number(match.value) || 0 : 0
            }
            return nutrients
        }

        return (results.foods || []).map(food => ({
            fdcId: food.fdcId,
            name: food.description,
            servingSize: 100,
            servingUnit: "g",
            nutrients: extractNutrients(food)
        }))
    }, [apiKey, query, FDC_NUTRIENT_NUMBERS])
}

module.exports = { searchFoods }
