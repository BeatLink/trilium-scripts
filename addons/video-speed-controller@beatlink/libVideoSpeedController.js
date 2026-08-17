// === Trilium Code note ===
// Title: libVideoSpeedController.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by videoSpeedController.js

/* video-speed-controller@beatlink — the controller itself, plus config loading.

A port of the Video Speed Controller browser extension: a draggable speed overlay on every HTML5
video, driven by keyboard shortcuts.

`controller()` is the whole extension in one function — it tracks the <video>/<audio> elements of
one document, draws the overlay, and binds the shortcuts. It is written as a closed function,
referencing nothing outside its own body, because it runs in two places: called directly for
Trilium's own renderer document, and stringified by guestScript() for a <webview>'s
executeJavaScript(), where nothing else of this module exists.
*/

let configPromise = null;

async function readJson(noteId) {
    if (!noteId) return {};
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [noteId]);
    try {
        return JSON.parse(content || "{}");
    } catch (error) {
        return {};
    }
}

// Merges the addon's stored config.json over schema.json's defaults. Only scalars and one flat
// `list` field are in this schema, so libsettings' full merge isn't needed — and requiring
// libSettingsUI.jsx here would drag its whole preact form into a plain script note's bundle.
async function getConfig(note) {
    if (!configPromise) {
        configPromise = (async () => {
            const schema = await readJson(await note.getRelationValue("schemaNote"));
            const stored = await readJson(await note.getRelationValue("configNote"));
            const values = {};
            for (const [key, definition] of Object.entries(schema)) {
                if (definition.type === "list") {
                    values[key] = Array.isArray(stored[key]) ? stored[key] : definition.default;
                } else {
                    values[key] = key in stored ? stored[key] : definition.default;
                }
            }
            return values;
        })();
    }
    return configPromise;
}

// Matches a hostname against the blacklist, so "youtube.com" also covers "www.youtube.com" and
// "music.youtube.com".
function isBlacklisted(hostname, config) {
    const host = hostname.toLowerCase().replace(/^www\./, "");
    return (config.blacklist || []).some((entry) => {
        const domain = (entry.name || "").trim().toLowerCase().replace(/^www\./, "");
        return !!domain && (host === domain || host.endsWith(`.${domain}`));
    });
}

function controller(config) {
    if (window.__videoSpeedController) return;
    window.__videoSpeedController = true;

    // What a browser will actually accept as a playbackRate.
    const MIN_SPEED = 0.07;
    const MAX_SPEED = 16;
    const SPEED_KEY = "videoSpeedController.speed";
    const OFFSET_KEY = "videoSpeedController.offset";
    const REPOSITION_MS = 300;

    const tracked = new Set();
    const markers = new WeakMap();
    let previousSpeed = 1;
    let hidden = !!config.startHidden;

    function clamp(speed) {
        return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
    }

    // A guest page can be on an origin whose storage is blocked (sandboxed frames, file: URLs),
    // where touching localStorage throws rather than returning null.
    function read(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function store(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            /* nothing to do — the speed is simply not remembered */
        }
    }

    function readOffset() {
        try {
            const saved = JSON.parse(read(OFFSET_KEY));
            return saved && typeof saved.x === "number" ? saved : { x: 0, y: 0 };
        } catch (error) {
            return { x: 0, y: 0 };
        }
    }

    let offset = readOffset();

    const box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;display:none;align-items:center;gap:2px;padding:2px;border-radius:4px;background:rgba(0,0,0,.75);color:#fff;font:12px/1 system-ui,sans-serif;user-select:none;cursor:grab";
    box.style.opacity = String(config.opacity);

    const readout = document.createElement("span");
    readout.style.cssText = "padding:3px 5px;font-variant-numeric:tabular-nums";

    const buttons = document.createElement("span");
    buttons.style.cssText = "display:none;gap:2px";

    box.append(readout, buttons);
    box.addEventListener("mouseenter", () => { buttons.style.display = "flex"; });
    box.addEventListener("mouseleave", () => { buttons.style.display = "none"; });

    function addButton(label, action) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.cssText = "border:none;border-radius:3px;padding:3px 6px;background:rgba(255,255,255,.15);color:#fff;font:12px/1 system-ui,sans-serif;cursor:pointer";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const media = pickTarget();
            if (media) action(media);
        });
        buttons.append(button);
    }

    // Ranks the document's media by area, doubling the score of anything playing so a big paused
    // video doesn't hold the overlay while a smaller one plays.
    function pickTarget() {
        let best = null;
        let bestScore = 0;
        for (const media of Array.from(tracked)) {
            if (!media.isConnected) {
                tracked.delete(media);
                continue;
            }
            const rect = media.getBoundingClientRect();
            const score = rect.width * rect.height * (media.paused ? 1 : 2);
            if (score > bestScore) {
                bestScore = score;
                best = media;
            }
        }
        return best;
    }

    // A fullscreen element renders above everything outside it, so the overlay has to move inside
    // the subtree that went fullscreen. A media element itself can't show children, so that case
    // falls back to the body and the overlay simply stays hidden until fullscreen ends.
    function reparent() {
        const full = document.fullscreenElement;
        const host = full && full.tagName !== "VIDEO" && full.tagName !== "AUDIO" ? full : document.body;
        if (box.parentElement !== host) host.append(box);
    }

    function place() {
        const media = pickTarget();
        if (!media || hidden) {
            box.style.display = "none";
            return;
        }

        const rect = media.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 20 || rect.bottom < 0 || rect.top > window.innerHeight) {
            box.style.display = "none";
            return;
        }

        readout.textContent = `${media.playbackRate.toFixed(2)}×`;
        box.style.display = "inline-flex";
        const top = config.position.startsWith("top") ? rect.top + 10 : rect.bottom - box.offsetHeight - 10;
        const left = config.position.endsWith("left") ? rect.left + 10 : rect.right - box.offsetWidth - 10;
        box.style.top = `${top + offset.y}px`;
        box.style.left = `${left + offset.x}px`;
    }

    function setSpeed(media, speed) {
        const next = clamp(speed);
        if (media.playbackRate !== next) media.playbackRate = next;
        if (config.rememberSpeed) store(SPEED_KEY, String(next));
        place();
    }

    // Reset and Preferred Speed are both toggles: press once to go to the named speed, again to
    // come back to whatever you were watching at.
    function toggleSpeed(media, speed) {
        if (Math.abs(media.playbackRate - speed) > 0.001) {
            previousSpeed = media.playbackRate;
            setSpeed(media, speed);
        } else {
            setSpeed(media, previousSpeed);
        }
    }

    function seek(media, seconds) {
        media.currentTime = Math.max(0, media.currentTime + seconds);
    }

    function applyRememberedSpeed(media) {
        if (!config.rememberSpeed) return;
        const saved = parseFloat(read(SPEED_KEY));
        if (saved > 0) media.playbackRate = clamp(saved);
    }

    function track(media) {
        if (tracked.has(media)) return;
        if (media.tagName === "AUDIO" && !config.enableAudio) return;
        tracked.add(media);
        // Sites reset playbackRate when they swap the source, and Trilium's own player has a speed
        // dropdown of its own — either way the readout follows the element rather than a value
        // this script believes it holds.
        media.addEventListener("ratechange", place);
        media.addEventListener("loadeddata", () => applyRememberedSpeed(media));
        applyRememberedSpeed(media);
        place();
    }

    function scan(root) {
        if (root.matches && root.matches("video, audio")) track(root);
        if (root.querySelectorAll) root.querySelectorAll("video, audio").forEach((media) => track(media));
    }

    addButton("−", (media) => setSpeed(media, media.playbackRate - config.speedStep));
    addButton("+", (media) => setSpeed(media, media.playbackRate + config.speedStep));
    addButton("«", (media) => seek(media, -config.rewindSeconds));
    addButton("»", (media) => seek(media, config.advanceSeconds));
    addButton("×", () => { hidden = true; place(); });

    const bindings = [
        [config.keySlower, (media) => setSpeed(media, media.playbackRate - config.speedStep)],
        [config.keyFaster, (media) => setSpeed(media, media.playbackRate + config.speedStep)],
        [config.keyReset, (media) => toggleSpeed(media, 1)],
        [config.keyPreferred, (media) => toggleSpeed(media, config.preferredSpeed)],
        [config.keyRewind, (media) => seek(media, -config.rewindSeconds)],
        [config.keyAdvance, (media) => seek(media, config.advanceSeconds)],
        [config.keyDisplay, () => { hidden = !hidden; place(); }],
        [config.keyMark, (media) => markers.set(media, media.currentTime)],
        [config.keyJump, (media) => { if (markers.has(media)) media.currentTime = markers.get(media); }]
    ];

    const actions = {};
    for (const [key, action] of bindings) {
        if (key) actions[String(key).toLowerCase()] = action;
    }

    function editable(node) {
        if (!node) return false;
        return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.isContentEditable;
    }

    // In Trilium's own document a bare letter key also means something to the note tree and the
    // editor, so the shortcuts can be limited to a player the pointer or the focus is actually on.
    // The parent is checked too: a player's own control bar sits above the video, so hovering the
    // controls doesn't hover the <video> itself.
    function engaged(media) {
        if (!config.hoverScope) return true;
        const parent = media.parentElement;
        return media.matches(":hover") || (!!parent && (parent.matches(":hover") || parent.contains(document.activeElement)));
    }

    document.addEventListener("keydown", (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (editable(event.target) || editable(document.activeElement)) return;

        const action = actions[event.key.toLowerCase()];
        if (!action) return;

        const media = pickTarget();
        if (!media || !engaged(media)) return;

        event.preventDefault();
        event.stopPropagation();
        action(media);
    }, true);

    box.addEventListener("pointerdown", (event) => {
        if (event.target !== box && event.target !== readout) return;
        event.preventDefault();
        const origin = { x: offset.x, y: offset.y };
        const startX = event.clientX;
        const startY = event.clientY;

        const move = (moveEvent) => {
            offset = { x: origin.x + moveEvent.clientX - startX, y: origin.y + moveEvent.clientY - startY };
            place();
        };
        const drop = () => {
            store(OFFSET_KEY, JSON.stringify(offset));
            box.removeEventListener("pointermove", move);
            box.removeEventListener("pointerup", drop);
        };

        box.setPointerCapture(event.pointerId);
        box.addEventListener("pointermove", move);
        box.addEventListener("pointerup", drop);
    });

    // Players are mounted, torn down and resized long after load — infinite feeds, single-page
    // navigation, Trilium switching notes — so both the tracking and the positioning repeat.
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("fullscreenchange", () => { reparent(); place(); });
    setInterval(() => { reparent(); place(); }, REPOSITION_MS);

    reparent();
    scan(document.documentElement);
}

// The guest page gets the same controller as a source string, since a <webview> shares no scope
// with the renderer that embeds it.
function guestScript(config) {
    return `(${controller.toString()})(${JSON.stringify(config)});`;
}

module.exports = { getConfig, isBlacklisted, controller, guestScript };
