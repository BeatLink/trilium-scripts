// === Trilium Code note ===
// Title: libWebViewAdblock.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by webViewAdblock.js

// EasyList's two cosmetic-only lists. Every rule in them is a plain element-hiding rule
// ("domain,domain##selector" or a bare "##selector"), which is why the parser below only
// has to understand that one form. Both hosts send Access-Control-Allow-Origin: *, and
// Trilium serves its app without a CSP, so the renderer can fetch them directly.
const FILTER_LISTS = [
    "https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt",
    "https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_specific_hide.txt"
];

// uBlock Origin's own catalogue, mapping the filter-list tokens a backup records
// ("easylist", "ublock-filters", ...) to the URLs they are fetched from.
const UBO_ASSETS_URL = "https://raw.githubusercontent.com/gorhill/uBlock/master/assets/assets.json";

const CACHE_KEY = "webViewAdblock.filters";
const CACHE_VERSION = 2;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A selector the CSS parser rejects kills the entire rule it sits in, so selectors go out
// in chunks — one bad rule from upstream costs a chunk instead of the whole stylesheet.
const CHUNK_SIZE = 200;

let loading = null;

// Splits "domain1,domain2##selector" into its parts, returning null for the lines this
// parser deliberately ignores: comments, exceptions, and uBO/ABP procedural syntax that
// isn't valid CSS. Note that "##" only ever appears in plain hiding rules — the "#@#",
// "#?#" and "#$#" markers don't contain it — so the split doubles as the filter.
function parseRule(line) {
    if (!line || line.startsWith("!") || line.startsWith("[") || line.includes("#@#")) return null;
    const marker = line.indexOf("##");
    if (marker < 0) return null;
    const selector = line.slice(marker + 2);
    if (!selector || selector.startsWith("+js(") || selector.includes(":-abp-") || selector.includes(":style(")) return null;
    return { domains: marker === 0 ? [] : line.slice(0, marker).split(","), selector };
}

// Turns the raw list text into { generic: [selector], specific: { domain: [selector] } }.
function compile(text) {
    const generic = [];
    const specific = {};
    for (const line of text.split("\n")) {
        const rule = parseRule(line.trim());
        if (!rule) continue;
        if (!rule.domains.length) {
            generic.push(rule.selector);
        } else {
            for (const domain of rule.domains) (specific[domain] = specific[domain] || []).push(rule.selector);
        }
    }
    return { version: CACHE_VERSION, fetchedAt: Date.now(), generic, specific };
}

// Fetched from the backend whenever that is available, because the renderer may only fetch hosts
// that send an Access-Control-Allow-Origin header and several lists uBO can be pointed at
// (Peter Lowe's, Fanboy's, someonewhocares.org) send none. Trying the renderer first and falling
// back would still log a CORS error per list on every refresh, which reads as a broken addon.
async function fetchList(url) {
    if (api.isBackendScriptingEnabled()) {
        return api.runAsyncOnBackendWithManualTransactionHandling(async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`${url} returned ${response.status}`);
            return response.text();
        }, [url]);
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.text();
}

async function download(synced) {
    const urls = synced ? synced.listUrls : FILTER_LISTS;
    const texts = await Promise.all(urls.map(fetchList));
    if (synced?.userFilters) texts.push(synced.userFilters);

    const filters = compile(texts.join("\n"));
    filters.syncedAt = synced ? synced.syncedAt : 0;
    return filters;
}

function readCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        return cached && cached.version === CACHE_VERSION ? cached : null;
    } catch (error) {
        return null;
    }
}

// Returns the compiled filter set, refreshing it from upstream once the cache is missing, a
// week old, or built from a different uBO sync than the one now in force. A failed refresh
// falls back to the stale cache when there is one.
function loadFilters(synced) {
    if (loading) return loading;

    const cached = readCache();
    const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE_MS;
    if (fresh && cached.syncedAt === (synced ? synced.syncedAt : 0)) {
        loading = Promise.resolve(cached);
        return loading;
    }

    loading = download(synced).then((filters) => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(filters));
        } catch (error) {
            console.warn("webview-adblock: could not cache filter lists", error);
        }
        return filters;
    }).catch((error) => {
        loading = null;
        if (!cached) throw error;
        console.warn("webview-adblock: filter refresh failed, using cached lists", error);
        return cached;
    });
    return loading;
}

// Builds the stylesheet for one hostname: every generic rule, plus the rules registered
// for the hostname itself or any of its parent domains.
async function cssForHostname(hostname, synced) {
    let filters;
    try {
        filters = await loadFilters(synced);
    } catch (error) {
        console.warn("webview-adblock: no filter lists available", error);
        return "";
    }

    const selectors = filters.generic.slice();
    const labels = hostname.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
        const domain = labels.slice(i).join(".");
        if (filters.specific[domain]) selectors.push(...filters.specific[domain]);
    }

    const rules = [];
    for (let i = 0; i < selectors.length; i += CHUNK_SIZE) {
        rules.push(`${selectors.slice(i, i + CHUNK_SIZE).join(",")}{display:none!important}`);
    }
    return rules.join("\n");
}

// ---------------------------------------------------------------------------
// uBlock Origin sync
//
// Reads a backup exported from uBO's dashboard (Settings -> Backup to file) and
// distils it into the three things this addon can actually act on: the URLs of the
// filter lists that were selected, the user's own filters, and the trusted sites.
// uBO's dynamic filtering rules, hostname switches, per-site switches and scriptlets
// have no equivalent here and are dropped.
//
// The result is written to a persistent note so both halves of the addon can read it
// — the backend network layer included, which has no other way to see this config.
// ---------------------------------------------------------------------------
async function syncFromUboBackup(backupPath, syncedNoteId) {
    if (!syncedNoteId) throw new Error("this script has no uboConfigNote relation");

    // readFileSync keeps the backend function synchronous, which runOnBackend requires.
    const raw = await api.runOnBackend(
        (path) => process.mainModule.require("fs").readFileSync(path, "utf8"),
        [backupPath]
    );
    const backup = JSON.parse(raw);
    if (!Array.isArray(backup.selectedFilterLists)) throw new Error(`${backupPath} is not a uBlock Origin backup`);

    const catalogue = JSON.parse(await fetchList(UBO_ASSETS_URL));

    // A token's contentURL is a string or a list whose later entries are paths inside uBO's
    // own repo; only the http ones are fetchable from here. "user-filters" has no entry at
    // all — those rules arrive as backup.userFilters instead.
    const listUrls = [];
    for (const token of backup.selectedFilterLists) {
        const asset = catalogue[token];
        if (!asset || asset.content !== "filters") continue;
        const url = [].concat(asset.contentURL).find((candidate) => candidate.startsWith("http"));
        if (url) listUrls.push(url);
    }

    const synced = {
        syncedAt: Date.now(),
        source: backupPath,
        uboVersion: backup.version || "",
        listUrls,
        userFilters: backup.userFilters || "",
        // Entries like "about-scheme" cover browser-internal pages, which never reach a web view.
        trusted: (backup.whitelist || []).filter((entry) => entry && !entry.startsWith("#") && !entry.endsWith("-scheme"))
    };

    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [syncedNoteId, JSON.stringify(synced, null, 4)]
    );
    return synced;
}

// Returns the last synced config, or null when nothing has been synced yet — in which case
// callers fall back to this addon's built-in lists.
async function loadSyncedConfig(syncedNoteId) {
    if (!syncedNoteId) return null;

    try {
        const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [syncedNoteId]);
        const synced = JSON.parse(content || "null");
        return synced?.listUrls?.length ? synced : null;
    } catch (error) {
        console.warn("webview-adblock: could not read the synced uBO config", error);
        return null;
    }
}

// uBO trusted-site entries are a hostname, which also covers its subdomains, optionally
// followed by a path prefix.
function isTrusted(pageUrl, trusted) {
    if (!trusted || !trusted.length || !pageUrl) return false;

    let url;
    try {
        url = new URL(pageUrl);
    } catch (error) {
        return false;
    }

    for (const entry of trusted) {
        const slash = entry.indexOf("/");
        const host = slash < 0 ? entry : entry.slice(0, slash);
        if (url.hostname !== host && !url.hostname.endsWith(`.${host}`)) continue;
        if (slash < 0 || `${url.pathname}${url.search}`.startsWith(entry.slice(slash))) return true;
    }
    return false;
}

module.exports = { loadFilters, cssForHostname, syncFromUboBackup, loadSyncedConfig, isTrusted };
