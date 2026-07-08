// Catalog CRUD + browsing. A "catalog" is a URL serving {"tam-addons": [manifestSourceUrl, ...]}
// — a flat list of addon manifest locations, no cached summary data.

const { loadDatabase, saveDatabase } = require("libTAMDatabase.js")
const { fetchJson, fetchManifest } = require("libTAMNetwork.js")

async function addCatalog(catalogUrl) {
    catalogUrl = catalogUrl.trim()
    if (!catalogUrl) return
    let database = await loadDatabase()
    if (!database.catalogs.includes(catalogUrl)) {
        database.catalogs.push(catalogUrl)
        await saveDatabase(database)
    }
}

async function deleteCatalog(catalogUrl) {
    let database = await loadDatabase()
    database.catalogs = database.catalogs.filter(u => u !== catalogUrl)
    await saveDatabase(database)
}

async function getCatalogs() {
    return (await loadDatabase()).catalogs
}

// Renders a catalog's "Visit Website" link without fetching every addon manifest it lists.
async function fetchCatalogMeta(catalogUrl) {
    return { webUrl: (await fetchJson(catalogUrl)).webUrl || null }
}

// Fetches a catalog's addon list fresh every time; a dead link or malformed manifest
// is skipped rather than failing the whole browse view.
async function fetchCatalogAddons(catalogUrl) {
    const catalog = await fetchJson(catalogUrl)

    const urls = catalog["tam-addons"] || []
    const results = await Promise.all(urls.map(async (manifestSourceUrl) => {
        try {
            const manifest = await fetchManifest(manifestSourceUrl)
            return { ...manifest, manifestSourceUrl }
        } catch (e) {
            console.error(`TAM: failed to fetch catalog entry ${manifestSourceUrl}`, e)
            return null
        }
    }))
    return { webUrl: catalog.webUrl || null, addons: results.filter(Boolean) }
}

module.exports.addCatalog = addCatalog
module.exports.deleteCatalog = deleteCatalog
module.exports.getCatalogs = getCatalogs
module.exports.fetchCatalogMeta = fetchCatalogMeta
module.exports.fetchCatalogAddons = fetchCatalogAddons
