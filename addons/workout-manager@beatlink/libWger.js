/*
 * wger exercise database lookup (https://wger.de), run entirely on the backend
 * (the frontend webview's CSP blocks direct fetch() to external hosts). No API
 * key required -- the exercise database is public and read-only. Helper
 * functions are declared inside the runAsyncOnBackendWithManualTransactionHandling
 * callback itself, since it crosses a serialization boundary and can't close
 * over outer-scope functions -- only over the arguments array passed as its 2nd
 * param.
 *
 * wger's API has no substring search endpoint (`/api/v2/exercise/search/` is
 * gone as of API 2.7): the only name filter is an exact match. So the whole
 * English exercise index is fetched once, slimmed backend-side to the few fields
 * this addon uses -- the raw response is several MB, almost all of it
 * descriptions, images and translations -- and then filtered here, in memory.
 */

// The full index is ~850 exercises and never changes mid-session, so it is
// fetched at most once per page load. The in-flight promise is what's cached, so
// two searches typed in quick succession share one request.
let indexPromise = null

async function fetchIndex() {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async () => {
        async function fetchJson(url) {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`wger request failed: ${response.status} ${response.statusText}`)
            return await response.json()
        }

        const languages = await fetchJson("https://wger.de/api/v2/language/?format=json&limit=100")
        const english = (languages.results || []).find(language => language.short_name === "en")
        const exercises = await fetchJson("https://wger.de/api/v2/exerciseinfo/?format=json&limit=999&language__code=en")

        return (exercises.results || []).map(exercise => {
            const translation = (exercise.translations || []).find(entry => entry.language === english?.id)
            return {
                id: exercise.id,
                name: translation?.name || "",
                category: exercise.category?.name || "",
                equipment: (exercise.equipment || []).map(item => item.name),
                muscles: [...(exercise.muscles || []), ...(exercise.muscles_secondary || [])]
                    .map(muscle => muscle.name_en || muscle.name)
                    .filter(Boolean)
            }
        }).filter(exercise => exercise.name)
    }, [])
}

/*
 * wger records equipment as its own list ("Barbell", "none (bodyweight
 * exercise)") and says nothing about how an exercise is measured, so the
 * measurement is inferred: anything in its Cardio category is cardio, anything
 * needing no equipment is bodyweight reps, everything else is weight and reps.
 * It is only a starting point -- the add form is still editable before saving.
 */
const BODYWEIGHT = "none (bodyweight exercise)"

function inferMeasurement(exercise) {
    if (exercise.category.toLowerCase() === "cardio") return "cardio"
    if (exercise.equipment.every(item => item === BODYWEIGHT)) return "bodyweight"
    return "weight"
}

// Equipment as one label, with wger's "no equipment" placeholder left out entirely.
function equipmentLabel(exercise) {
    return exercise.equipment.filter(item => item !== BODYWEIGHT).join(", ")
}

// Name substring match, case-insensitive, best (earliest) match first.
async function searchExercises(term) {
    const needle = String(term || "").trim().toLowerCase()
    if (!needle) return []
    if (!indexPromise) {
        indexPromise = fetchIndex().catch(error => {
            // A failed fetch must not poison the cache, or every later search
            // would replay the same error without retrying.
            indexPromise = null
            throw error
        })
    }
    const index = await indexPromise
    return index
        .map(exercise => ({ exercise, position: exercise.name.toLowerCase().indexOf(needle) }))
        .filter(({ position }) => position >= 0)
        .sort((a, b) => a.position - b.position || a.exercise.name.localeCompare(b.exercise.name))
        .slice(0, 25)
        .map(({ exercise }) => ({
            wgerId: exercise.id,
            name: exercise.name,
            measurement: inferMeasurement(exercise),
            equipment: equipmentLabel(exercise),
            muscles: exercise.muscles,
            category: exercise.category
        }))
}

module.exports = { searchExercises }
