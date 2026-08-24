/* webview-keepassxc@beatlink — the KeePassXC browser protocol, backend half.

Speaks the same protocol keepassxc-browser speaks, minus the browser. The real extension talks to
KeePassXC over native messaging, where `keepassxc-proxy` translates Chrome's length-prefixed stdio
framing into writes on a local socket. Nothing here can be a native messaging host, so this connects
to that socket directly instead, which is why messages go out as bare JSON with no length prefix.

Every message after the key exchange is a NaCl box: encrypted with KeePassXC's session public key and
this client's session secret key under a random 24-byte nonce, and answered under that nonce
incremented by one. Three key pairs are involved, exactly as upstream describes them — a session pair
on each side, discarded when the connection closes, plus a permanent identification pair whose public
half is what a database recognises the client by on later connections. Only that public half is ever
sent, so it, not the secret key, is the credential worth protecting; the frontend stores it.

Each exported call opens its own connection, exchanges keys, does its work and hangs up. A local
socket round trip costs well under a millisecond, so a persistent connection would buy nothing but a
reconnect state machine — and there is nowhere durable to keep one, since a frontend
runOnBackend call is evaluated in a fresh bundle every time.

To use:
    - Add this as a JS backend note, as a direct child of the frontend note that calls it.
    - Keep nacl-fast.min.js as a direct child of this note.
    - Backend scripting must be enabled in config.ini ([Security] backendScriptingEnabled=true).

Reference: https://github.com/keepassxreboot/keepassxc-browser/blob/develop/keepassxc-protocol.md
*/

const nacl = require("nacl-fast.min.js");

// Blocked by Trilium's require(), so reach Node's own registry the way the rest of this repo does.
// This rests on process.mainModule, which is deprecated in Node and would go away if Trilium's
// server bundle ever moved to ESM.
const net = process.mainModule.require("net");
const os = process.mainModule.require("os");
const path = process.mainModule.require("path");

const SERVER_NAME = "org.keepassxc.KeePassXC.BrowserServer";

// Nonces, client ids and public keys are all 24 or 32 bytes; only the nonce length is protocol-wide.
const NONCE_LENGTH = 24;

// Long enough to cover a KeePassXC that is asking the user something (an access-control prompt on
// get-logins, a name for a new association, a database password on triggerUnlock), and short enough
// that a KeePassXC which died mid-request doesn't hang a web view forever.
const REQUEST_TIMEOUT_MS = 120000;
const CONNECT_TIMEOUT_MS = 2000;

// A signal KeePassXC pushes on its own rather than a reply to anything, so a reader waiting for a
// response has to step over it.
const NOTIFICATIONS = new Set(["database-locked", "database-unlocked"]);

const DATABASE_NOT_OPENED = 1;

// KeePassXC reports "nothing matched this URL" as an error rather than an empty entry list, and on
// most pages that is the ordinary answer.
const NO_LOGINS_FOUND = 15;

// --- encoding ---------------------------------------------------------------

const encode = (bytes) => Buffer.from(bytes).toString("base64");
const decode = (text) => new Uint8Array(Buffer.from(text, "base64"));

// libsodium's own increment: little-endian add of one, carried across the whole nonce.
function incrementNonce(nonce) {
    const bytes = decode(nonce);
    let carry = 1;
    for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i];
        bytes[i] = carry & 0xff;
        carry >>= 8;
    }
    return encode(bytes);
}

const newNonce = () => encode(nacl.randomBytes(NONCE_LENGTH));

// --- transport --------------------------------------------------------------

// Where KeePassXC puts its socket, in the order BrowserShared::localServerPath would have chosen.
// The dedicated app/ directory is current; the bare runtime-dir entry is the symlink kept there for
// older clients, and is what a KeePassXC too old to have moved the socket still listens on.
function candidatePaths(override) {
    if (override) return [override];

    if (process.platform === "win32") {
        const user = process.env.USERNAME || os.userInfo().username;
        return [`\\\\.\\pipe\\${SERVER_NAME}_${user}`];
    }

    const paths = [];
    if (process.platform !== "darwin" && process.env.XDG_RUNTIME_DIR) {
        paths.push(path.join(process.env.XDG_RUNTIME_DIR, "app", "org.keepassxc.KeePassXC", SERVER_NAME));
        paths.push(path.join(process.env.XDG_RUNTIME_DIR, SERVER_NAME));
    }
    if (process.env.SNAP_USER_COMMON) paths.push(path.join(process.env.SNAP_USER_COMMON, SERVER_NAME));
    paths.push(path.join(process.env.TMPDIR || os.tmpdir(), SERVER_NAME));
    return paths;
}

// Splits the read buffer into whole top-level JSON objects. The socket carries a bare concatenation
// of them with no framing, so the only way to tell where one ends is to count braces — tracking
// strings and escapes so a brace inside a password can't be mistaken for structure.
function takeMessages(buffer) {
    const messages = [];
    let depth = 0;
    let start = -1;
    let end = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (char === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
                messages.push(buffer.slice(start, i + 1));
                start = -1;
                end = i + 1;
            }
        }
    }

    // Anything after the last complete object is the head of one still arriving.
    return { messages, rest: buffer.slice(end) };
}

function openSocket(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(socketPath);
        socket.setTimeout(CONNECT_TIMEOUT_MS);
        socket.once("connect", () => {
            socket.setTimeout(0);
            resolve(socket);
        });
        socket.once("timeout", () => socket.destroy(new Error(`Timed out connecting to ${socketPath}`)));
        socket.once("error", reject);
    });
}

async function connect(override) {
    const paths = candidatePaths(override);
    let lastError = null;

    for (const socketPath of paths) {
        try {
            return wrap(await openSocket(socketPath));
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`Could not reach KeePassXC (tried ${paths.join(", ")}): ${lastError && lastError.message}`);
}

// One request at a time, so a reply is simply the next message that isn't an unsolicited signal —
// no need for the extension's nonce-keyed message buffer. The nonce is still checked, one level up,
// as proof the reply belongs to this request.
function wrap(socket) {
    let buffer = "";
    let pending = null;
    let failure = null;

    const fail = (error) => {
        failure = error;
        if (pending) {
            pending.reject(error);
            pending = null;
        }
    };

    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const { messages, rest } = takeMessages(buffer);
        buffer = rest;

        for (const text of messages) {
            let message;
            try {
                message = JSON.parse(text);
            } catch (error) {
                fail(new Error("KeePassXC sent a message that is not valid JSON"));
                return;
            }
            if (NOTIFICATIONS.has(message.action)) continue;
            if (pending) {
                const settle = pending;
                pending = null;
                settle.resolve(message);
            }
        }
    });

    socket.on("error", (error) => fail(error));
    socket.on("close", () => fail(new Error("KeePassXC closed the connection")));

    return {
        request(payload) {
            if (failure) return Promise.reject(failure);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => fail(new Error("KeePassXC did not answer in time")), REQUEST_TIMEOUT_MS);
                pending = {
                    resolve: (message) => {
                        clearTimeout(timer);
                        resolve(message);
                    },
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    }
                };
                socket.write(JSON.stringify(payload));
            });
        },
        close() {
            socket.removeAllListeners("close");
            socket.destroy();
        }
    };
}

// --- session ----------------------------------------------------------------

// Exchanges session keys, runs one caller's worth of requests over that session, then hangs up.
async function session(options, body) {
    const connection = await connect(options.socketPath);
    try {
        const keyPair = nacl.box.keyPair();
        const clientID = encode(nacl.randomBytes(NONCE_LENGTH));
        const nonce = newNonce();

        const response = await connection.request({
            action: "change-public-keys",
            publicKey: encode(keyPair.publicKey),
            nonce,
            clientID
        });

        if (response.success !== "true" || !response.publicKey) throw new Error("KeePassXC refused the key exchange");
        if (response.nonce !== incrementNonce(nonce)) throw new Error("KeePassXC answered the key exchange with the wrong nonce");

        return await body({
            connection,
            clientID,
            keyPair,
            serverPublicKey: decode(response.publicKey),
            version: response.version
        });
    } finally {
        connection.close();
    }
}

// Sends one encrypted action and returns its decrypted reply. `envelope` carries the few fields that
// travel outside the box, which today means triggerUnlock.
async function send(context, action, message, envelope = {}) {
    const nonce = newNonce();
    const plaintext = new Uint8Array(Buffer.from(JSON.stringify({ action, ...message }), "utf8"));
    const boxed = nacl.box(plaintext, decode(nonce), context.serverPublicKey, context.keyPair.secretKey);
    if (!boxed) throw new Error(`Could not encrypt the ${action} request`);

    const response = await context.connection.request({
        action,
        message: encode(boxed),
        nonce,
        clientID: context.clientID,
        ...envelope
    });

    // A refusal comes back outside the box, so it is readable without a successful decrypt.
    if (response.error) {
        const error = new Error(response.error);
        error.errorCode = response.errorCode;
        throw error;
    }
    if (!response.message || !response.nonce) throw new Error(`KeePassXC sent an empty reply to ${action}`);

    const opened = nacl.box.open(decode(response.message), decode(response.nonce), context.serverPublicKey, context.keyPair.secretKey);
    if (!opened) throw new Error(`Could not decrypt the reply to ${action}`);

    const parsed = JSON.parse(Buffer.from(opened).toString("utf8"));
    if (parsed.nonce !== incrementNonce(nonce)) throw new Error(`KeePassXC answered ${action} with the wrong nonce`);
    return parsed;
}

// --- actions ----------------------------------------------------------------

/* Whether KeePassXC is reachable and, if it is, which database is open.
   `hashes` are the database hashes this client already holds keys for. */
async function status(options = {}) {
    try {
        return await session(options, async (context) => {
            try {
                const response = await send(context, "get-databasehash", { connectedKeys: options.hashes || [] });
                return { available: true, locked: false, version: context.version, hash: response.hash };
            } catch (error) {
                if (error.errorCode === DATABASE_NOT_OPENED) {
                    return { available: true, locked: true, version: context.version, hash: null };
                }
                throw error;
            }
        });
    } catch (error) {
        return { available: false, locked: false, version: null, hash: null, error: error.message };
    }
}

/* Registers this client with the open database. KeePassXC asks the user to name the association and
   stores the identification public key against that name, which is what test-associate and
   get-logins later recognise. Returns the key ring entry the caller has to persist. */
async function associate(options = {}) {
    return session(options, async (context) => {
        const identity = nacl.box.keyPair();
        const idKey = encode(identity.publicKey);

        const response = await send(
            context,
            "associate",
            { key: encode(context.keyPair.publicKey), idKey },
            { triggerUnlock: "true" }
        );

        if (response.success !== "true" || !response.id) throw new Error("KeePassXC declined the association");
        return { hash: response.hash || "", id: response.id, key: idKey };
    });
}

/* Credentials for one URL. `keyring` maps a database hash to the association held for it, because
   which one applies is decided by whichever database happens to be open right now.

   The three requests are not optional. KeePassXC refuses get-logins outright unless *this connection*
   has already proved its association (`m_associated` in BrowserAction, reset on every new socket), and
   the only thing that sets it is associate or test-associate — a stored key ring counts for nothing on
   its own. Asking for the hash first is what says which association to prove. */
async function getLogins(options = {}) {
    const keyring = options.keyring || {};
    const hashes = Object.keys(keyring);
    if (!hashes.length) throw new Error("Not associated with any KeePassXC database yet");

    return session(options, async (context) => {
        const unlock = options.triggerUnlock ? { triggerUnlock: "true" } : {};

        const { hash } = await send(context, "get-databasehash", { connectedKeys: hashes }, unlock);
        const association = keyring[hash];
        if (!association) throw new Error("The open KeePassXC database is not the one this Trilium is associated with — connect to it from the settings page");

        const proof = await send(context, "test-associate", { id: association.id, key: association.key });
        if (proof.success !== "true") throw new Error("KeePassXC no longer recognises this association — connect again from the settings page");

        const message = {
            id: association.id,
            url: options.url,
            keys: hashes.map((key) => ({ id: keyring[key].id, key: keyring[key].key }))
        };
        if (options.submitUrl) message.submitUrl = options.submitUrl;

        try {
            const response = await send(context, "get-logins", message, unlock);
            return { hash: response.hash || "", entries: response.entries || [] };
        } catch (error) {
            if (error.errorCode === NO_LOGINS_FOUND) return { hash, entries: [] };
            throw error;
        }
    });
}

module.exports = { status, associate, getLogins };
