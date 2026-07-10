# TAM/addon gotchas

- No `env=hybrid`: a JS/JSX note is `env=frontend` or `env=backend` and can only `require()` notes
  of the same environment. Needed in both? Ship as two notes sharing one `sourceUrl`.
- A `#customResourceProvider` JS note served over HTTP (`<script src="custom/x.js">`) must use a
  plain `application/javascript` mime with NO `;env=frontend` suffix. Trilium's `downloadData` sets
  `Content-Type` verbatim from the note mime, and browsers refuse to execute a script whose type
  carries the non-standard `env=` parameter (silent MIME-rejection, calendar/widget just never
  loads). If the same file is ALSO `require()`d (which needs `env=frontend`), ship a separate
  resource note (bare mime, distinct title, local child of the `require`able note so it rides its
  install closure) rather than reusing the module note. `validate.py` exempts
  `customResourceProvider`-labeled notes from the env-qualifier warning.
- Only `.jsx` notes are transpiled (ES `export`/`import`). Plain `.js` notes run as-is — use
  CommonJS `module.exports`/`require()`.
- Library note titles are global identifiers (`require("Title")` matches by exact title across
  every addon). Never use a generic title; renaming one is a breaking change.
- Use `api.startNote` (not `api.currentNote`) when reading relations the manifest placed on a
  specific note — `currentNote` varies per module inside a bundle, `startNote` doesn't.
- `#TAMFILEID` is the only note-identity mechanism; resolution is always find-or-create, never
  cached. No offline "repair" exists — reinstall via `syncAddon` instead.
- The manifest `dependencies` array is metadata only — it does NOT install anything. An addon's
  notes are installed only when another addon references one of its `exports` via a `children[]` (or
  `relations[]`) entry carrying `addon` + `child`/`to`. A dep that's listed but never wired is never
  installed, so any `#customResourceProvider` it ships 404s (`custom/<x>.js` -> HTTP 404, MIME
  `text/plain`). Fix by giving the dep real `exports` and wiring them from the consumer, mirroring how
  `libcalendar@beatlink` wires `libical@kewisch`.
- Renamed destructuring on a `require()` call (`const { foo: bar } = require(...)`) silently breaks —
  `bar` ends up `undefined` at runtime with no error until called ("X is not a function"). Destructure
  with the original export names and alias via a separate `const alias = foo` line instead, or just
  use ES `import { foo as bar } from "..."` when the importing note's env supports it.
