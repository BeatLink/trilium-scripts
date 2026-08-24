# TweetNaCl.js

Vendored copy of [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) 1.0.3 by Dmitry Chestnykh and
contributors (public domain — see the Unlicense in the upstream repository). Implements NaCl's
`crypto_box` (X25519-XSalsa20-Poly1305), `crypto_secretbox`, `crypto_sign` and hashing. Bundled here
verbatim as `nacl-fast.min.js` so other addons in this repo don't each need their own copy.

This is a raw vendor dependency exposed as-is — there's no BeatLink-authored wrapper, since consumers
use the upstream API directly.

Node's own `crypto` covers X25519 but not XSalsa20-Poly1305, so an addon speaking a NaCl-box protocol
(KeePassXC's browser protocol, for one) has no built-in alternative.

## Usage

Clone the `lib` note as a direct child of your own backend script note, then require it by title:

```js
const nacl = require("nacl-fast.min.js")
const keyPair = nacl.box.keyPair()
const boxed = nacl.box(message, nonce, theirPublicKey, keyPair.secretKey)
```

`nacl.util` is a separate upstream package and is *not* included; convert to and from base64 with
Node's `Buffer` instead.

## The `crypto` note

`crypto-shim.js` ships as a note titled exactly `crypto`, wired as a child of the `lib` note. Trilium
rewrites a script bundle's `require()` into a resolver over the requiring note's children, falling
back to a short allowlist that does not include `crypto` — and tweetnacl calls `require("crypto")` at
load time to find a PRNG. Without a child note under that title the call throws and the whole
vendored file fails to load; with it, tweetnacl gets real `randomBytes` and `nacl.randomBytes` works.

The shim reaches Node's module registry through `process.mainModule`, the same escape hatch the rest
of this repo uses for modules the bundler blocks. It is backend-only: there is no frontend variant of
this library, since a frontend script gets `crypto.getRandomValues` from the browser and tweetnacl
finds it by itself.
