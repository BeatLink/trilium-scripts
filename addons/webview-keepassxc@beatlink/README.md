# Web View KeePassXC

Fills logins from **KeePassXC** into Trilium Desktop's built-in **Web View** note type — the parts of
the KeePassXC-Browser extension that matter for logging in, rebuilt around an Electron `<webview>`.

A web view is not a browser, so it cannot install an extension and Trilium cannot register itself as
a native messaging host. Instead this addon connects to KeePassXC's local socket directly and speaks
the same encrypted protocol `keepassxc-proxy` would have relayed.

## What it does

- Connects to a running KeePassXC and associates with an open database, once.
- On each page a web view loads, asks KeePassXC for entries matching that URL.
- Draws a small **KP** button in the login form's username field, with a dropdown of matching entries.
- Fills the username, password and — when the entry has TOTP and the page has a one-time-code field —
  the current one-time code.
- Optionally fills automatically when exactly one entry matches.

## Requirements

- Trilium **Desktop** (browser Trilium renders a web view as a cross-origin `<iframe>`, which nothing
  can inject into).
- KeePassXC 2.7 or newer, running, with **Browser Integration** enabled in its settings. The browser
  it is enabled *for* does not matter — enabling the integration is what starts the socket.
- Backend scripting enabled in Trilium: `[Security] backendScriptingEnabled=true` in `config.ini`,
  or `TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true`.

## Setup

1. Unlock the database you want to use in KeePassXC.
2. Open **TAM → Web View KeePassXC → Settings**, go to the **Connection** tab and press **Connect**.
3. KeePassXC asks you to name the association. The name you give appears in its
   **Database → Database Settings → Browser Integration** list, and can be revoked from there.
4. Open a Web View note and load a site you have an entry for.

Repeat the Connect step once per database. **Forget associations** clears this side of the pairing;
removing the other side is done in KeePassXC.

## How it works

### Protocol (`libKeePassXc.js`, backend)

KeePassXC listens on a local socket — `$XDG_RUNTIME_DIR/app/org.keepassxc.KeePassXC/org.keepassxc.KeePassXC.BrowserServer`
on Linux, the user's temporary directory on macOS, a named pipe on Windows — and the addon tries the
documented locations in order, or the one you set in settings. Messages go over it as bare JSON with
no framing, because framing is `keepassxc-proxy`'s job on the stdio side and it writes the payload
through unchanged.

After a `change-public-keys` exchange, every message is a NaCl box: encrypted with KeePassXC's
session public key and this client's session secret key under a random 24-byte nonce, and answered
under that nonce incremented by one, which is checked on the way back. Three key pairs are involved,
as upstream describes them — a session pair on each side, discarded when the connection closes, and a
permanent **identification** pair whose public half is what a database recognises the client by later.

Node's `crypto` has X25519 but not XSalsa20-Poly1305, so this uses
[TweetNaCl.js](../../libs/libtweetnacl/) — which needs one trick to load at all under Trilium's
bundler, described in that library's README.

Each call opens its own connection, exchanges keys, does its work and hangs up. A local socket round
trip costs well under a millisecond, and a frontend `runOnBackend` call is evaluated in a fresh
bundle every time, so there is nowhere to keep a persistent connection even if it were worth having.

A fetch is therefore three requests, not one. KeePassXC refuses `get-logins` unless *that connection*
has already proved its association — `m_associated` in `BrowserAction`, reset on every new socket —
and only `associate` or `test-associate` sets it, so a stored key ring counts for nothing on its own.
Each fetch asks for the database hash, proves the association held for that hash, and only then asks
for logins.

### Bridge (`libWebViewKeePassXc.js`, frontend)

A frontend script cannot open a socket, so every protocol call goes through
`api.runAsyncOnBackendWithManualTransactionHandling`, which posts to the authenticated
`/api/script/exec`. Deliberately **not** a `customRequestHandler`: Trilium serves `/custom/*` with no
authentication and no CSRF check, which is fine for a calendar feed and not fine for passwords.

The key ring — a map of database hash to the `{ id, key }` KeePassXC issued for it — lives in a
persistence note. `key` is the public half of the identification key pair, but possession of that
string is what a database accepts, so treat it as a credential; it sits in the Trilium database and
syncs with it.

### Page agent (`guestAgent`, injected)

Trilium's web views have no preload script, so the only way into a page is
`webview.executeJavaScript`. The agent is shipped as its own source text via
`Function.prototype.toString`, finds the login fields, and draws the picker inside a **closed shadow
root** so the page's stylesheets cannot reach it.

Field detection: the first visible `input[type=password]`, then the last visible text field above it
as the username — which is what a login form looks like whether or not the two share a `<form>`. A
page with no password field is treated as the first step of a two-step login, so its first text field
is the username. A one-time-code field is recognised by `autocomplete="one-time-code"` or by an
`otp`/`2fa`/`verification code` hint in its name, id, placeholder or label. Values are written
through the prototype's `value` setter followed by `input` and `change` events, so a framework that
tracks its own state sees the change.

The agent answers back through `console.log` with a `__kpxc__` prefix, read off the element's
`console-message` event — the only channel a web view offers without a preload script. That line
carries an **entry index**, never a credential; the password travels the other way, host to guest,
and only once an entry has been chosen.

## Security

- Credentials only reach a page KeePassXC itself agreed to release them for. The first time a site
  asks, KeePassXC shows its own access-control prompt.
- Once filled, a field is readable by the page's own scripts — the same exposure as any browser
  autofill. That is why **automatic filling is off by default**.
- Because the return channel is the page's console, a page can emit a `__kpxc__` line itself and
  trigger a fill without you clicking. It can only ever get credentials that were already fetched for
  its own URL and already approved for it in KeePassXC, so this matches what automatic filling would
  hand it anyway — but it is the reason the picker is not a security boundary.
- The addon never writes to your database. There is no "save this login" prompt.

## Not implemented

Saving or updating entries (`set-login`), Passkeys, HTTP Basic auth, custom `KPH:` string fields,
password generation, and automatic form submission. Entry matching is left entirely to KeePassXC.
