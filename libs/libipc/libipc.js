// A tiny cross-plugin event bus for TriliumNext frontend addons.
//
// Every frontend widget/script runs inside the same browser window, so a
// single shared bus on `window` lets independent TAM addons broadcast live
// events to each other without any shared config, persistence, or note
// relations. Publishing an event synchronously notifies every subscriber that
// is currently listening; there is no history and no delivery to listeners
// that subscribe later — it is fire-and-forget messaging, not shared state.
//
// The bus is created lazily on first use and reused across addons that
// require this library, so whichever addon loads first wins and the rest
// attach to the same instance.

const BUS_KEY = "__triliumIpcBus__";

function getBus() {
    if (!window[BUS_KEY]) {
        window[BUS_KEY] = new EventTarget();
    }
    return window[BUS_KEY];
}

// Broadcast an event to every current subscriber of `channel`. `payload` is
// delivered untouched as the second argument to each handler.
function publish(channel, payload) {
    getBus().dispatchEvent(new CustomEvent(channel, { detail: payload }));
}

// Subscribe `handler` to `channel`. `handler` is called as
// `handler(payload, channel)` for each published event. Returns an
// unsubscribe function; call it (e.g. on widget teardown) to stop listening.
function subscribe(channel, handler) {
    const listener = (event) => handler(event.detail, channel);
    getBus().addEventListener(channel, listener);
    return () => getBus().removeEventListener(channel, listener);
}

module.exports = { publish, subscribe };
