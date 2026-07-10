# TAM/addon gotchas

- No `env=hybrid`: a JS/JSX note is `env=frontend` or `env=backend` and can only `require()` notes
  of the same environment. Needed in both? Ship as two notes sharing one `sourceUrl`.
- Only `.jsx` notes are transpiled (ES `export`/`import`). Plain `.js` notes run as-is — use
  CommonJS `module.exports`/`require()`.
- Library note titles are global identifiers (`require("Title")` matches by exact title across
  every addon). Never use a generic title; renaming one is a breaking change.
- Use `api.startNote` (not `api.currentNote`) when reading relations the manifest placed on a
  specific note — `currentNote` varies per module inside a bundle, `startNote` doesn't.
- `#TAMFILEID` is the only note-identity mechanism; resolution is always find-or-create, never
  cached. No offline "repair" exists — reinstall via `syncAddon` instead.
