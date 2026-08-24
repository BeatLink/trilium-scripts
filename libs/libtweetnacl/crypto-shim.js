// Stands in for Node's crypto module under that exact title, because Trilium's script bundler
// rewrites require() into a note-title resolver and rejects "crypto" outright.
// tweetnacl calls require("crypto") at load time to wire its PRNG, so without this note the
// vendored file throws while loading rather than merely ending up without randomBytes.
module.exports = process.mainModule.require("crypto")
