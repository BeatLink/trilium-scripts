// === Trilium Code note ===
// Title: libWebPreview.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by webViewToolbarWidget.js

// ---------------------------------------------------------------------------
// Creates a Web View note for `url` under `parentNoteId` and returns its noteId.
// ---------------------------------------------------------------------------
async function createWebViewNote(parentNoteId, url, title) {
    return api.runOnBackend((parentNoteId, url, title) => {
        const { note } = api.createNewNote({
            parentNoteId,
            title: title || url,
            type: "webView",
            content: "",
            mime: "text/html"
        });
        note.setLabel("webViewSrc", url);
        return note.noteId;
    }, [parentNoteId, url, title]);
}

// ---------------------------------------------------------------------------
// Renames a note, skipping the write when the title already matches so that a
// page reporting the same title repeatedly doesn't churn the note's revisions.
// ---------------------------------------------------------------------------
async function renameNote(noteId, title) {
    const trimmed = (title || "").trim();
    if (!trimmed) return;

    const note = await api.getNote(noteId);
    if (!note || note.title === trimmed) return;

    await api.runOnBackend((noteId, title) => {
        const note = api.getNote(noteId);
        note.title = title;
        note.save();
    }, [noteId, trimmed]);
}

// ---------------------------------------------------------------------------
// The note a saved page is filed under: the one configured in settings, else
// whichever note carries an #inbox label.
// ---------------------------------------------------------------------------
async function resolveSaveParentNoteId(saveParentNoteId) {
    if (saveParentNoteId) return saveParentNoteId;

    const results = await api.searchForNotes("#inbox");
    if (results.length === 0) throw new Error("no Save Location is set and no note is labelled #inbox");
    return results[0].noteId;
}

// ---------------------------------------------------------------------------
// Opens a URL in the system's default browser. Uses the renderer's electronApi
// bridge — backend scripts can't require("electron"), it isn't on the allowed
// module list.
// ---------------------------------------------------------------------------
function openExternal(url) {
    window.electronApi?.shell?.openExternal(url);
}

// ---------------------------------------------------------------------------
// Deletes the Web View note itself, for clearing out saved links once you're
// done with them. Trilium's delete is soft,
// so the note stays recoverable from Recent Changes. The parent is read before
// the delete and activated after, since the tab would otherwise be left sitting
// on a note that no longer exists.
// ---------------------------------------------------------------------------
async function deleteWebViewNote(noteId) {
    const note = await api.getNote(noteId);
    const parentNoteId = note?.getParentNoteIds()[0];

    await api.runOnBackend((noteId) => api.getNote(noteId).deleteNote(), [noteId]);

    if (parentNoteId) await api.activateNote(parentNoteId);
}

// ---------------------------------------------------------------------------
// Guest-page script, injected on every page load, that swallows link clicks and
// reports them to the toolbar. Trilium's <webview> has no preload script, so the
// guest's console is the only channel back to the host; the host's `will-navigate`
// can't be cancelled, hence intercepting the click instead of the navigation.
// ---------------------------------------------------------------------------
const LINK_MESSAGE_PREFIX = "web-preview:link:";

const LINK_INTERCEPT_SCRIPT = `(() => {
    if (window.__webPreviewLinkIntercept) return;
    window.__webPreviewLinkIntercept = true;
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const anchor = event.target && event.target.closest && event.target.closest("a[href]");
        if (!anchor || !/^https?:/i.test(anchor.href)) return;
        event.preventDefault();
        event.stopPropagation();
        console.log(${JSON.stringify(LINK_MESSAGE_PREFIX)} + JSON.stringify({ url: anchor.href, title: (anchor.textContent || "").trim() }));
    }, true);
})()`;

// ---------------------------------------------------------------------------
// Reads one console message from the guest page, returning {url, title} for a
// clicked link and null for the page's own console output.
// ---------------------------------------------------------------------------
function parseLinkMessage(message) {
    if (typeof message !== "string" || !message.startsWith(LINK_MESSAGE_PREFIX)) return null;
    try {
        return JSON.parse(message.slice(LINK_MESSAGE_PREFIX.length));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Turns what was typed into the New Tab box into the URL to open and a note title.
// A full URL or a bare host goes straight there; anything else is a query for
// `urlTemplate`, whose `%s` placeholder receives it URL-encoded. Returns null for
// a query when no template was given, so the caller can say no provider is set up.
// ---------------------------------------------------------------------------
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST_RE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i;
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

function buildNewTabTarget(text, urlTemplate) {
    const trimmed = text.trim();
    let url = null;
    if (SCHEME_RE.test(trimmed)) url = trimmed;
    // A bare host or IP is nearly always a server on the LAN, which rarely speaks TLS.
    else if (LOCAL_HOST_RE.test(trimmed)) url = `http://${trimmed}`;
    else if (BARE_HOST_RE.test(trimmed)) url = `https://${trimmed}`;

    if (url) return { url, title: hostnameOf(url) };
    if (!urlTemplate) return null;
    return { url: urlTemplate.replace(/%s/g, encodeURIComponent(trimmed)), title: trimmed };
}

// Hostname of a URL, falling back to the URL itself when it can't be parsed.
function hostnameOf(url) {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}

// ---------------------------------------------------------------------------
// SponsorBlock. The lookup itself is shared with youtube-manager@beatlink; what
// belongs here is applying its answer to a page loaded in the <webview>.
// ---------------------------------------------------------------------------
const sponsorBlock = require("libSponsorBlock.js");

// ---------------------------------------------------------------------------
// Guest-page script that seeks the page's <video> past whichever segments the
// host has pushed into it. Injected on every load like the link interceptor,
// and self-guarding so re-injection is harmless. It polls rather than listening
// for timeupdate because YouTube replaces the <video> element between videos.
// ---------------------------------------------------------------------------
const SPONSORBLOCK_SCRIPT = `(() => {
    if (window.__webPreviewSponsorBlock) return;

    const state = { videoId: "", segments: [], notify: true, skipped: new Set() };
    window.__webPreviewSponsorBlock = state;

    state.apply = (next) => {
        state.videoId = next.videoId || "";
        state.segments = next.segments || [];
        state.notify = !!next.notify;
        state.skipped = new Set();
    };

    const LABELS = ${JSON.stringify(sponsorBlock.SPONSORBLOCK_LABELS)};

    function toast(text) {
        let el = document.getElementById("web-preview-sponsorblock-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "web-preview-sponsorblock-toast";
            el.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:rgba(0,0,0,.85);color:#fff;font:13px sans-serif;padding:8px 12px;border-radius:6px;pointer-events:none;transition:opacity .3s";
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = "1";
        clearTimeout(el.hideTimer);
        el.hideTimer = setTimeout(() => { el.style.opacity = "0"; }, 2500);
    }

    const ID_RE = new RegExp(${JSON.stringify(sponsorBlock.YOUTUBE_ID_RE.source)}, "i");

    setInterval(() => {
        if (state.segments.length === 0) return;
        // Segments fetched for the previous video must never be applied to the one
        // a single-page navigation has already swapped in.
        const match = ID_RE.exec(location.href);
        if (!match || match[1] !== state.videoId) return;

        const video = document.querySelector("video");
        if (!video || video.paused) return;

        for (const segment of state.segments) {
            // A segment is skipped once only, so rewinding into one plays it.
            if (state.skipped.has(segment.uuid)) continue;
            if (video.currentTime < segment.start || video.currentTime >= segment.end - 0.2) continue;
            state.skipped.add(segment.uuid);
            video.currentTime = segment.end;
            if (state.notify) toast("Skipped: " + (LABELS[segment.category] || segment.category));
            break;
        }
    }, 250);
})()`;

// The call that hands the guest script a video's segments.
function sponsorBlockApplyScript(payload) {
    return `window.__webPreviewSponsorBlock && window.__webPreviewSponsorBlock.apply(${JSON.stringify(payload)})`;
}

module.exports = { createWebViewNote, renameNote, resolveSaveParentNoteId, openExternal, deleteWebViewNote, LINK_INTERCEPT_SCRIPT, parseLinkMessage, buildNewTabTarget, SPONSORBLOCK_SCRIPT, sponsorBlockApplyScript };
