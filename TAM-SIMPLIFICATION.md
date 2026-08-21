# TAM simplification notes

Analysis only, no code changed. Based on `lib-tam.js` (2276 lines) and `TAM.jsx` (1342 lines) as of
commit 3a27266 plus the uncommitted youtube-manager edits.

## Section sizes (lib-tam.js)

| Section | Lines |
| --- | --- |
| Diagnostics | 406 |
| Note resolution | 324 |
| Settings review | 278 |
| Install / Sync | 212 |
| Uninstall / recovery | 185 |
| Metadata review | 179 |
| Network | 99 |
| Lifecycle / query | 103 |
| Persistence | 92 |
| Manifest shape | 86 |

## 1. Four parallel prompt mechanisms (~550 lines)

The update review exists four times:

- whole-content diff — `collectPendingPrompts`, lib-tam.js:695
- settings review — `settingsReviewItems`, lib-tam.js:859
- metadata review — `metadataReviewItems`, lib-tam.js:1130
- the addon-supplied `hooks.updateReview` list

All four do the same three-way merge (*declared then* vs *declared now* vs *live*), all four store a
baseline under `record.persistence.*`, all four emit `{key, label, current, incoming,
defaultSelected}`.

The only real differences: where the baseline lives, how the live value is read, and how the chosen
value is written. That is a `{ readBaseline, readLive, applyOne }` triple, not three subsystems.

`resolvePrompt` (lib-tam.js:745) is a four-way branch that collapses with them. The content prompt's
boolean-instead-of-item-map shape is the only reason the `if (prompt.items)` fork exists —
normalizing it to a single-item list removes the fork.

Biggest win, but it touches user-facing review behaviour. Run the manifest corpus before and after.

## 2. Database round-trips

26 `loadDatabase()` against 14 `saveDatabase()`; each is a full backend note read + JSON parse.

`syncAddon` reloads the database it already holds three times (lib-tam.js:1455, :1467, :1478) and
writes prompts in three separate passes at the tail.

One `updateDatabase(fn)` helper plus a single write at the end of the sync removes
`saveSettingsBaseline`, `recordSettingsBaseline`, `saveMetadataBaseline` and `clearPendingPrompts`
as distinct functions — they are all the same read-modify-write.

Low risk, self-contained. Good first task.

## 3. One backend round-trip per note

`resolveNotes` makes one `runOnBackend` per note, plus one per attachment set; then
`reconcileNoteParenting` makes another per note. A 40-note addon is roughly 100 IPC hops.

`readLiveAddon` (lib-tam.js:1674) already proves the batched shape works. Moving the loop inside the
closure makes the sync faster and shorter — per-note error handling becomes one array of results
instead of a try/catch per iteration.

## 4. `fetchWithRetry` exists 4 times

Top-level at lib-tam.js:198, then re-inlined verbatim inside the `resolveAttachments` and
`resolveNotes` backend closures (backend closures cannot capture frontend scope).

But the frontend already fetches for `renderAsHTML` and for `collectPendingPrompts`, so the split is
arbitrary. Committing to "frontend fetches, backend only writes" deletes both inline copies and makes
the backend closures pure writes. Cost: base64 over the bridge for binaries, which `noteDef.content`
already pays.

Low risk, self-contained.

## 5. Invariants duplicated between sync and audit

The shared-note adoption guard, including its 8-line comment, is copy-pasted between `resolveNotes`
(lib-tam.js:530) and `readLiveAddon` (lib-tam.js:1683) — each comment notes it mirrors the other.

Same for "which notes are comparable against a manifest `sha`" and the `disabled:` prefix handling,
re-implemented in five places: `applyLabels`, `applyRelation`, `applyMetadataSelections`,
`liveMetadata`, `diagnose`.

These are exactly the spots where drift between what the sync writes and what the audit expects turns
into false diagnostics. Extract as shared pure predicates.

Low risk, and pairs well with item 2.

## 6. The two-pass sync

`syncAddon` resolves persistence and structure as two `resolveManifest` calls (lib-tam.js:1372-1396),
which forces `scopeLocalIds`, `existingNoteMap` and `deferredRelations` to exist as options purely to
stitch the halves back together.

`topologicalSort` already orders the notes, so one pass that picks each note's anchor from its own
reserved parent keyword drops three of the six `resolveManifest` options and the deferred-relation
replay entirely.

## Smaller items

- `resolveNotes` does `m.notes.find(n => n.id === localId)` inside its loop — O(n^2); build the map
  once.
- `buildParentMaps` and `persistentLocalIds` are recomputed in both `resolveNotes` and
  `reconcileNoteParenting`.
- `diagnose` is a 406-line linear checklist in one function; a table of check functions each
  returning rows would read better, though this is cosmetic next to item 5.
- Docs are 51KB `ARCHITECTURE.md` + 35KB `MANIFEST.md` for a ~3.6k-line addon.

## Suggested order

1. Item 2 (database helper) and item 5 (shared predicates) — contained, independent, make item 1
   easier.
2. Item 4 (single fetch path).
3. Item 6 (one-pass sync).
4. Item 3 (batched backend calls).
5. Item 1 (unified review) last, with the manifest corpus run either side.

Rough ceiling if all six land: lib-tam.js around 1400-1600 lines, with the sync/audit drift risk
removed structurally rather than maintained by matching comments.
