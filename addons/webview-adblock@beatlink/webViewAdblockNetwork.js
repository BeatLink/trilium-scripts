/* Web View Adblock — network layer

Blocks ad and tracker requests inside Trilium Desktop's Web View notes by attaching an
EasyList-derived filter to the Electron session those notes browse in. On desktop the backend
runs inside the Electron main process, which is the only place session.webRequest is reachable.

Only rules decidable from the request itself are compiled: "||host^" hostname rules and pattern
rules whose options are resource types and/or $third-party. Rules carrying $domain=, $document or
negated options are skipped, so this under-blocks rather than risking a broken page.

To use:
    - Add this script as a JS backend note with #run=backendStartup.
    - Backend scripting must be enabled in Options -> Security.
*/

// EasyList covers ads, EasyPrivacy covers trackers — the same pair uBlock Origin enables by
// default. EasyPrivacy's per-brand CNAME files are left out: a long tail of cloaked hostnames
// that would triple the download.
const BASE = "https://raw.githubusercontent.com/easylist/easylist/master";
const AD_LISTS = [
    `${BASE}/easylist/easylist_adservers.txt`,
    `${BASE}/easylist/easylist_thirdparty.txt`,
    `${BASE}/easylist/easylist_general_block.txt`,
    `${BASE}/easylist/easylist_specific_block.txt`
];

const TRACKER_LISTS = [
    `${BASE}/easyprivacy/easyprivacy_general.txt`,
    `${BASE}/easyprivacy/easyprivacy_specific.txt`,
    `${BASE}/easyprivacy/easyprivacy_thirdparty.txt`,
    `${BASE}/easyprivacy/easyprivacy_trackingservers_general.txt`,
    `${BASE}/easyprivacy/easyprivacy_trackingservers_thirdparty.txt`
];

const ALLOW_LISTS = [
    `${BASE}/easylist/easylist_allowlist.txt`,
    `${BASE}/easyprivacy/easyprivacy_allowlist.txt`
];

// Must stay in step with WEBVIEW_SESSION_PARTITION in Trilium's shared_constants.ts — a rename
// upstream silently leaves this filtering a session nothing browses in.
const WEBVIEW_PARTITION = "persist:webview";

// ABP option name -> Electron resourceType. An option outside this map disqualifies its rule.
const RESOURCE_TYPES = {
    script: "script", image: "image", stylesheet: "stylesheet", subdocument: "subFrame",
    xmlhttprequest: "xhr", media: "media", font: "font", object: "object",
    websocket: "webSocket", ping: "ping", other: "other"
};

const HOSTNAME_RULE = /^\|\|([a-z0-9.-]+)\^$/i;

// Some lists uBlock Origin can be pointed at (Peter Lowe's, for one) ship in hosts-file format
// rather than ABP syntax.
const HOSTS_LINE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+([a-z0-9.-]+)\s*$/i;

// Translates an ABP URL pattern into regular expression source: "||" anchors at the scheme with
// any subdomain, "|" anchors at either end, "^" is ABP's separator class, "*" is a wildcard.
function patternToSource(pattern) {
    let source = "";
    let start = 0;
    let end = pattern.length;

    if (pattern.startsWith("||")) {
        source += "^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?";
        start = 2;
    } else if (pattern.startsWith("|")) {
        source += "^";
        start = 1;
    }

    const anchorEnd = end > start && pattern.endsWith("|");
    if (anchorEnd) end -= 1;

    for (let i = start; i < end; i++) {
        const char = pattern[i];
        if (char === "*") source += ".*";
        else if (char === "^") source += "(?:[^a-zA-Z0-9_.%-]|$)";
        else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    return anchorEnd ? `${source}$` : source;
}

// Splits "pattern$opt,opt" into the pattern, the resource types it is restricted to (null when
// unrestricted) and whether it only applies to third-party requests. Returns null for a rule using
// any option this script can't honour.
function parseRule(rule) {
    const marker = rule.lastIndexOf("$");
    if (marker < 0) return { pattern: rule, types: null, thirdParty: false };

    const types = [];
    let thirdParty = false;
    for (const option of rule.slice(marker + 1).split(",")) {
        if (option === "third-party") {
            thirdParty = true;
            continue;
        }
        const type = RESOURCE_TYPES[option];
        if (!type) return null;
        types.push(type);
    }
    return { pattern: rule.slice(0, marker), types: types.length ? types : null, thirdParty };
}

function isValidSource(source) {
    try {
        new RegExp(source);
        return true;
    } catch (error) {
        return false;
    }
}

// Folds one list's text into the accumulator, skipping comments and every cosmetic rule (those
// belong to the frontend half of this addon).
function compile(text, compiled) {
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("!") || line.startsWith("[") || line.includes("#")) continue;

        const hosts = HOSTS_LINE.exec(line);
        if (hosts) {
            if (hosts[1].toLowerCase() !== "localhost") compiled.always.hosts.add(hosts[1].toLowerCase());
            continue;
        }

        const allow = line.startsWith("@@");
        const parsed = parseRule(allow ? line.slice(2) : line);
        // A pattern too short to be meaningful compiles to a regex that matches every URL, which
        // would cancel the whole session's traffic.
        if (!parsed || parsed.pattern.length < 3) continue;

        // Only unconditional exceptions are kept: the conditional block rules they would cancel
        // are themselves skipped, so honouring them would just punch holes in what is left.
        if (allow && (parsed.types || parsed.thirdParty)) continue;

        addRule(allow ? compiled.allow : parsed.thirdParty ? compiled.thirdParty : compiled.always, parsed);
    }
}

function addRule(bucket, parsed) {
    // Whole-host rules go into sets: a hash lookup per request instead of a pattern test.
    const hostname = HOSTNAME_RULE.exec(parsed.pattern);
    if (hostname) {
        const host = hostname[1].toLowerCase();
        if (!parsed.types) bucket.hosts.add(host);
        else for (const type of parsed.types) (bucket.hostsByType[type] = bucket.hostsByType[type] || new Set()).add(host);
        return;
    }

    const source = patternToSource(parsed.pattern);
    if (!isValidSource(source)) return;

    const entry = { re: new RegExp(source, "i"), types: parsed.types ? new Set(parsed.types) : null };
    const token = longestToken(parsed.pattern);
    if (!token) {
        bucket.untokenized.push(entry);
        return;
    }

    const entries = bucket.byToken.get(token);
    if (entries) entries.push(entry);
    else bucket.byToken.set(token, [entry]);
}

// Every literal in an ABP pattern is required, so the longest one is a cheap prefilter: a URL
// missing it cannot possibly match. Patterns whose literals are all shorter than the tokenizer's
// minimum have to be tested against every request instead.
const TOKEN = /[a-z0-9]{4,}/g;

function longestToken(pattern) {
    const tokens = pattern.toLowerCase().match(TOKEN);
    if (!tokens) return null;
    return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
}

function emptyBucket() {
    return { hosts: new Set(), hostsByType: {}, byToken: new Map(), untokenized: [] };
}

function countRules(bucket) {
    const sizes = [
        bucket.hosts.size,
        ...Object.values(bucket.hostsByType).map((hosts) => hosts.size),
        bucket.untokenized.length,
        ...Array.from(bucket.byToken.values(), (entries) => entries.length)
    ];
    return sizes.reduce((total, size) => total + size, 0);
}

function matchesAny(entries, url, resourceType) {
    for (const entry of entries) {
        if ((!entry.types || entry.types.has(resourceType)) && entry.re.test(url)) return true;
    }
    return false;
}

function buildBucketMatcher(bucket) {
    return (url, tokens, hostname, resourceType) => {
        const typeHosts = bucket.hostsByType[resourceType];
        const labels = hostname.split(".");
        for (let i = 0; i < labels.length - 1; i++) {
            const domain = labels.slice(i).join(".");
            if (bucket.hosts.has(domain)) return true;
            if (typeHosts && typeHosts.has(domain)) return true;
        }

        for (const token of tokens) {
            const entries = bucket.byToken.get(token);
            if (entries && matchesAny(entries, url, resourceType)) return true;
        }
        return matchesAny(bucket.untokenized, url, resourceType);
    };
}

// Approximates the registrable domain as the last two labels. Without a public suffix list a pair
// like a.co.uk / b.co.uk reads as same-party, which under-blocks rather than over-blocks.
function isThirdParty(hostname, pageUrl) {
    if (!pageUrl) return false;

    let pageHost;
    try {
        pageHost = new URL(pageUrl).hostname;
    } catch (error) {
        return false;
    }
    return hostname.split(".").slice(-2).join(".") !== pageHost.split(".").slice(-2).join(".");
}

function buildMatcher(compiled) {
    const allow = buildBucketMatcher(compiled.allow);
    const always = buildBucketMatcher(compiled.always);
    const thirdParty = buildBucketMatcher(compiled.thirdParty);

    return function shouldBlock(url, resourceType, pageUrl) {
        let hostname;
        try {
            hostname = new URL(url).hostname;
        } catch (error) {
            return false;
        }

        const tokens = url.toLowerCase().match(TOKEN) || [];
        if (allow(url, tokens, hostname, resourceType)) return false;
        if (always(url, tokens, hostname, resourceType)) return true;
        return isThirdParty(hostname, pageUrl) && thirdParty(url, tokens, hostname, resourceType);
    };
}

// The frontend half owns the uBlock Origin sync (it has the settings UI); this side just reads
// what it left in the shared note. Absent or empty means the built-in lists apply.
function readSyncedConfig() {
    const syncedNoteId = api.startNote.getRelationValue("uboConfigNote");
    if (!syncedNoteId) return null;

    try {
        const synced = JSON.parse(api.getNote(syncedNoteId).getContent() || "null");
        return synced?.listUrls?.length ? synced : null;
    } catch (error) {
        api.log("webview-adblock: the synced uBO config is unreadable, falling back to the built-in lists");
        return null;
    }
}

// uBO trusted-site entries are a hostname, which also covers its subdomains, optionally
// followed by a path prefix.
function isTrusted(pageUrl, trusted) {
    if (!trusted.length || !pageUrl) return false;

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

async function install() {
    if (!process.versions.electron) {
        api.log("webview-adblock: not running under Electron, network blocking skipped");
        return;
    }

    // Trilium rewrites a script bundle's own require() into a child-note resolver, so this is the
    // only route left to Electron's module registry. It rests on process.mainModule, which is
    // deprecated in Node and would disappear if Trilium's desktop bundle ever moved to ESM.
    const { session } = process.mainModule.require("electron");

    // What the frontend last synced out of a uBlock Origin backup, if anything. Its list
    // selection replaces the built-in one wholesale — the point of syncing is to block what
    // Firefox blocks, not the union of that and this addon's own defaults.
    const synced = readSyncedConfig();
    const urls = synced ? synced.listUrls : [...AD_LISTS, ...TRACKER_LISTS, ...ALLOW_LISTS];

    const texts = await Promise.all(urls.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        return response.text();
    }));
    if (synced?.userFilters) texts.push(synced.userFilters);

    const compiled = { always: emptyBucket(), thirdParty: emptyBucket(), allow: emptyBucket() };
    for (const text of texts) compile(text, compiled);

    const shouldBlock = buildMatcher(compiled);
    const trusted = synced ? synced.trusted : [];

    session.fromPartition(WEBVIEW_PARTITION).webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        try {
            // A guest page must always be able to load itself, so main-frame navigation is never
            // cancelled. The top frame's URL is what makes a request first- or third-party.
            const pageUrl = details.resourceType === "mainFrame" ? null : (details.frame && details.frame.top && details.frame.top.url);
            const filtered = details.resourceType !== "mainFrame" && !isTrusted(pageUrl, trusted);
            callback({ cancel: filtered && shouldBlock(details.url, details.resourceType, pageUrl) });
        } catch (error) {
            callback({ cancel: false });
        }
    });

    const source = synced ? `uBO backup (${urls.length} lists, ${trusted.length} trusted sites)` : "built-in lists";
    api.log(`webview-adblock: filtering ${WEBVIEW_PARTITION} from ${source} with ${countRules(compiled.always)} unconditional and ${countRules(compiled.thirdParty)} third-party rules, ${countRules(compiled.allow)} exceptions`);
}

install().catch((error) => api.log(`webview-adblock: network blocking failed to start -- ${error.message}`));
