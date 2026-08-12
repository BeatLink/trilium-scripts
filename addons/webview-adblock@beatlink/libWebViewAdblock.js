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

const CACHE_KEY = "webViewAdblock.filters";
const CACHE_VERSION = 1;
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

async function download() {
    const texts = await Promise.all(FILTER_LISTS.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        return response.text();
    }));
    return compile(texts.join("\n"));
}

function readCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        return cached && cached.version === CACHE_VERSION ? cached : null;
    } catch (error) {
        return null;
    }
}

// Returns the compiled filter set, refreshing it from upstream once the cache is missing
// or a week old. A failed refresh falls back to the stale cache when there is one.
function loadFilters() {
    if (loading) return loading;

    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
        loading = Promise.resolve(cached);
        return loading;
    }

    loading = download().then((filters) => {
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
async function cssForHostname(hostname) {
    let filters;
    try {
        filters = await loadFilters();
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

module.exports = { loadFilters, cssForHostname };
