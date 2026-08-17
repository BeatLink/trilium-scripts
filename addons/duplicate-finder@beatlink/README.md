# Duplicate Finder

Finds notes that are copies of each other and converts the extra copies into **clones** of whichever
copy you choose to keep — so the note exists once, but still appears everywhere each copy used to.

## Why clones

Deleting a duplicate loses its placement: whatever branch it sat in no longer shows anything. This
addon never does that. For every copy you merge away, it first clones the keeper into each parent
that copy occupied, and only then deletes the copy. The tree looks the same afterwards; there is just
one real note behind those positions instead of several drifting ones.

Deletion is skipped entirely (and reported) if any clone fails, so a failure can never cost you a
placement.

## Usage

The addon installs two notes under its root:

- **Duplicate Notes** — the scan page. Click **Scan for duplicates** to get one card per duplicate
  group.
- **duplicate-finder@beatlink** — the settings page (also reachable from TAM's **Settings** button).

Each group card lists every copy with its creation/modification date and the parents it currently
lives under. Pick which copy survives with the radio button — the **oldest is selected by default**
— then click **Convert N to clones**. Clicking a copy's title opens that note, so you can look before
choosing.

Merged groups drop off the list immediately; the rest stay actionable without rescanning.

### Copies with children are never merged

A copy that has children is shown but excluded from the merge, because deleting it would take its
whole subtree with it. Either keep that copy instead, or move its children elsewhere first and
rescan.

## What counts as a duplicate

By default, two notes are duplicates when their **title**, **content** and **attributes** all match.
Every part is configurable in Settings:

### Matching

| Setting | Default | Effect |
|---|---|---|
| **Match Title** | on | Titles must be identical. |
| **Match Content** | on | Content must be identical. |
| **Match Attributes** | on | The notes' own labels and relations must be identical. |
| **Ignore Formatting** | on | Compare content with HTML tags stripped and whitespace collapsed, so a reformatted copy still matches. |
| **Ignore Title Case** | off | Compare titles case-insensitively. |
| **Skip Empty Notes** | on | Skip notes with no content — otherwise every empty note matches every other one. |

At least one of Title / Content / Attributes must be on; the scan refuses to run otherwise, since
with all three off every note would collide into a single group.

Two things are always compared regardless of settings:

- **Note type and MIME** — a code note and a text note holding the same text are not interchangeable
  and must never merge.
- **Only a note's own attributes** — inherited and templated attributes are ignored, since they say
  nothing about whether two notes are the same note. (`#TAMFILEID` is excluded too: it is addon
  bookkeeping, and it is inherited by every note templated from an addon-owned template.)

### Scope

| Setting | Default | Effect |
|---|---|---|
| **Scan Under** | whole tree | Limit the scan to one note's subtree. |
| **Exclude Filters** | see below | Notes matching any enabled filter's search query are skipped. |

Two exclude filters ship enabled by default:

- **Addon-owned notes** (`#TAMFILEID`) — addon-installed notes are legitimately identical across
  addons that vendor the same library file, and are managed by TAM rather than by you.
- **Templates** (`#template`) — templates are meant to be copied from.

Both can be disabled, and you can add your own using ordinary Trilium search syntax (e.g.
`#archived`, `note.type = code`). A filter with a malformed query is logged and skipped rather than
aborting the scan.

Search notes and launchers are always skipped. The scan walks down from the tree root, so the hidden
subtree is never visited.

### What updates do to your settings

Anything shipped with the addon (the two exclude filters, and every default in the tables above)
keeps tracking future versions for as long as you leave it alone: if a later version changes one,
the change reaches your install on the next update without asking. Once you edit a filter or change
a default it is yours, and is never overwritten. Should a later version change that same setting,
TAM's **Update Review** asks which version you want rather than deciding for you. A filter you
deleted stays deleted.

## Notes

- The scan walks the subtree directly rather than issuing a search, so **Scan Under** is exact and a
  note cloned into several places is still examined once.
- Existing clones are not duplicates: a clone is one note with several parents, so it is visited once
  and can never match itself.
