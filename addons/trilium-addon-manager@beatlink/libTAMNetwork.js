// Fetch/retry/version-comparison helpers — pure networking, no note-tree access.
// fetchWithRetry is duplicated inline inside every api.runOnBackend callback that also
// needs it throughout this addon, since those callbacks are serialized into a separate
// context that can't close over this module-level copy.

function versionCompare(remote, local) {
    return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
}

// Retries on HTTP 429, honoring Retry-After when sent, else exponential backoff.
async function fetchWithRetry(url, maxRetries = 5) {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(url)
        if (response.status !== 429 || attempt >= maxRetries) return response
        const retryAfter = Number(response.headers.get("retry-after"))
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 15000)
        await new Promise(resolve => setTimeout(resolve, delayMs))
    }
}

// Fetch-and-parse a URL on the backend, retrying through 429s.
async function fetchJson(url) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (url) => {
        // Own copy of fetchWithRetry: this callback is serialized and runs in
        // a separate backend context that can't close over the module-level one.
        async function fetchWithRetry(url, maxRetries = 5) {
            for (let attempt = 0; ; attempt++) {
                const response = await fetch(url)
                if (response.status !== 429 || attempt >= maxRetries) return response
                const retryAfter = Number(response.headers.get("retry-after"))
                const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(1000 * 2 ** attempt, 15000)
                await new Promise(resolve => setTimeout(resolve, delayMs))
            }
        }
        const response = await fetchWithRetry(url)
        return await response.json()
    }, [url])
}

async function fetchManifest(manifestSourceUrl) {
    return await fetchJson(manifestSourceUrl)
}

module.exports.versionCompare = versionCompare
module.exports.fetchWithRetry = fetchWithRetry
module.exports.fetchJson = fetchJson
module.exports.fetchManifest = fetchManifest
