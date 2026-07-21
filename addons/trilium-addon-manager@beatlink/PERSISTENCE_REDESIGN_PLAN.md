# Persistence redesign: two-roots model

Status: **plan, not yet implemented.** Replaces the `#TAMDATAID` copy-on-write
persistence subsystem with lifecycle-by-placement under a second manifest root.

See the design investigation artifact for the *why*. This file is the *how*.

## Model summary

A manifest gains a second structural anchor, `persistenceRoot`, alongside `addonRoot`.
A note's parent chain determines its lifecycle:

| Under | On sync | On update | On uninstall |
|-------|---------|-----------|--------------|
| `addonRoot` (today's behavior) | resolved + content-written | content overwritten (unless `skipOnUpdate`) | pruned/deleted |
| `persistenceRoot` | created once with manifest default | create-once, then `promptOnUpdate` (always) | never touched |

Locked decisions:
- Persistent notes keep the **same `#TAMFILEID = addonId/localId`** scheme. No `#TAMDATAID`.
- **Placement is the whole signal** — no per-note `AddonData:` relation, no persistence flags.
- **All persistent notes are `promptOnUpdate` by default.** The `promptOnUpdate` field is removed.
- Persistent notes are **authored in place** under `persistenceRoot`; their real id never moves,
  so `~template`/`renderNote` relations from structural notes stay valid forever.

## Why the engine needs almost no structural change (verified)

- `resolveNotes` treats `m.notes` as a flat list; parenting comes only from `children[]`.
  A persistent note is just one whose `children[]` chain roots at the persistenceRoot note.
  `topologicalSort`/`buildParentMaps` need no root-awareness. (lib-tam.js:172, 326)
- Relations resolve both endpoints from a single `noteMap` (lib-tam.js:955-962), independent of
  parenting. A cross-root edge `structural --template--> tpl-task` already works — two `noteMap` entries.
- The one place that MUST change: the `#TAMFILEID`-prefix sweeps
  (`pruneRemovedNotes` lib-tam.js:556, `detachAddonOwnedBranches` lib-tam.js:1377) scan globally by
  label, not by subtree, so they WILL catch persistent notes unless told to skip them.

## Identifying a persistent note in a sweep

Derived from the manifest, passed into the backend callback as a set of persistent local ids:

```
persistentLocalIds(m) = { every note id whose primaryParent chain (children[]) reaches m.persistenceRoot }
```

Compute on the frontend (pure, over `m.children`), pass `[...persistentLocalIds]` into each sweep
callback. A note with `#TAMFILEID = addonId/<localId>` where `localId ∈ persistentLocalIds` is skipped.

## Phase 1 — engine support in TAM (no addon migration yet)

Each step lists its verify check.

1. **Manifest schema + validator.** Add optional `persistenceRoot` to the manifest (a local id, like
   `root`). Update the `validate` script's manifest checks to accept it and to reject a note that is
   under `persistenceRoot` but also carries `skipOnUpdate`/`promptOnUpdate` (now implied/removed).
   → verify: `validate` passes on an unmodified repo; rejects a hand-made bad manifest.

2. **`persistentLocalIds(m)` helper** in lib-tam.js (pure, over `children[]`). Unit-exercise by
   logging on agenda's manifest: should return the `tpl-*` + `config` ids, not structural ids.
   → verify: console check during a test sync of a fixture addon.

3. **`resolveNotes`: create-once for persistent notes.** For a note in `persistentLocalIds`, when it
   already exists, never overwrite content (same code path as `skipOnUpdate` today, lib-tam.js:427).
   When it does NOT exist, create it with the manifest default exactly as now.
   → verify: install fixture, edit the persistent note, re-sync, confirm edit survives.

4. **`promptOnUpdate` becomes automatic for persistent notes.** `collectPendingPrompts`
   (lib-tam.js:773) currently keys off `noteDef.promptOnUpdate` + the `AddonData:` relation. Rewrite
   to: for each persistent note, diff incoming manifest content vs. live note content; queue a prompt
   on difference. Drop the `AddonData:` relation lookup.
   → verify: install fixture, ship a manifest with changed default, confirm Update Review appears
     with Keep Mine / Use New Default and both apply correctly.

5. **Sweeps skip persistent notes.** `pruneRemovedNotes` and `detachAddonOwnedBranches` receive
   `persistentLocalIds` and `continue` past any matching note.
   → verify: uninstall fixture, confirm persistent note remains; confirm structural notes are gone;
     reinstall, confirm the persistent note is re-adopted (found by `#TAMFILEID`).

6. **Retire the copy-on-write machinery.** Once 1-5 pass, delete: `connectAddonPersistence`,
   `migrateLegacyPersistence`, `cleanupEmptyPersistenceRoots`, the `#TAMDATAID` label + all guards,
   the `AddonData:`-relation handling, the `persistenceNotes` map plumbing, and the `addonPersistence`
   relation / "Addon Data" anchor from TAM's own manifest. Update `syncAddon` (drops the
   `connectAddonPersistence` call, lib-tam.js:1030) and `deleteAddon` (drops the persistence-keeping
   branch — survival now comes from placement, lib-tam.js:1440).
   → verify: `validate`; full install/update/uninstall/reinstall cycle on the fixture.

## Phase 2 — one-time migration of existing installs

Runs once per addon on the first sync after the TAM update (gate on a marker, mirroring how
`migrateLegacyPersistence` gated today). Per addon with old-model persistence:

1. For each `#TAMDATAID = addonId/key` note under "Addon Data": re-home it under the addon's new
   `persistenceRoot` subtree, re-tag `#TAMFILEID = addonId/<localId>` (localId = the manifest's new
   persistent-note id for that key), drop `#TAMDATAID`.
2. Existing `~template`/inbound relations already point at that real note id — verify they resolve;
   this is a check, not a rewire (ids unchanged).
3. Delete the emptied "Addon Data" per-addon folder; strip the `persistence` sub-object from the record.

→ verify: take a real DB snapshot with agenda installed + user-created tasks; run migration; confirm
  tasks' `~template` still resolve, config edits survive, no dangling notes.

## Phase 3 — migrate the 13 addon manifests

Order: **agenda first** (hardest — 11 templates + config, and `tpl-special` is both a `template`
target and persistent). Prove the whole cycle on it before the rest.

For each manifest: add a `persistenceRoot` note + child edges placing the former `AddonData:` targets
under it; delete the `AddonData:` relations and any `promptOnUpdate`/`skipOnUpdate` on those notes;
bump version; `validate`; regenerate docs/README if catalog fields changed.

The 13: agenda, budget, drawio@siriusxt, email-to-trilium, cinnamon-applet-{agenda,inbox,first-child},
expanded, template-picker, priority-widget, simplecalendar, area-picker, togglenotes.

## Risks / open checks

- **`persistenceRoot` note itself** needs `skipOnUpdate`-like create-once semantics too (it's the
  anchor; its content is a stub). Treat the root as persistent by definition.
- **Cross-root topological order:** a structural note under `addonRoot` with a `~template` to a
  persistent note is fine (relations are post-parenting), but confirm no `children[]` edge crosses
  roots in a way that makes `topologicalSort` place a child before its real parent. Placement should
  keep each note under exactly one root; validate this.
- **`findExternalReferences`** (lib-tam.js:1452) should no longer flag user notes pointing at
  persistent notes as dangerous, since those now survive uninstall by rule. Review its warning set.

## Rollout

Phase 1 is shippable alone (engine understands `persistenceRoot`; old `AddonData:` addons keep
working until Phase 2/3 touch them ONLY IF we keep a compatibility shim — otherwise Phases 1-3 ship
together). Decide: big-bang (1+2+3 one release) vs. staged with a temporary dual-read shim.
Recommendation: **big-bang**, since the 13 addons and TAM ship from this one repo and are versioned together.
