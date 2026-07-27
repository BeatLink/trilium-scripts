# Media Tracker

A movie and TV tracker for TriliumNext. Your whole library lives in **one JSON note** under a library
root you choose, so it is a single note you can back up, inspect, or hand-edit — and the library root
itself becomes the tracker UI.

Replaces [`stremio-sync@beatlink`](../stremio-sync@beatlink), which this addon absorbs.

## Setup

1. Install and enable the addon.
2. Open its Settings page and paste a **TMDB API key** (free, from
   [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)). This powers search,
   posters, and episode lists.
3. Create a note to hold your library (anywhere in your tree), then pick it on the **Library Root**
   tab in Settings. This is required — every tracked title is created as a child of it.
4. Optionally set up Trakt and/or Stremio on the Import tab.

Picking a Library Root wires it up automatically: the note is converted to a **render note** pointing
at the tracker widget and given a movie icon, so opening it in your tree shows the tracker itself.
Choosing a different note reverts the old one back to a plain text note, and clearing the setting
reverts it without selecting a replacement.

## Using it

The widget has three tabs.

**Library** shows everything you track, with filters that compose:

- a **search box** that narrows by title as you type (case-insensitive substring)
- **Type** (All / Movies / TV), **Status**, **Collection**, and **Genre** dropdowns

Every option carries its own count, and each dropdown is scoped by the filters before it but never by
itself — so selecting one option never zeroes out the others, and a count always tells you how many
rows that choice would show. Status is colour-coded throughout: grey for planned,
blue for watching, green for watched, red for dropped.

Each row has a status dropdown, a ★ rating box (0-10, blank for unrated), an **Episodes** toggle for
shows, and a **×** to remove the title. A show's row shows its progress — episodes watched and
seasons started — and expanding it shows episodes watched and seasons *completed*.

**Refresh** runs a housekeeping sweep over the whole library: it re-fetches metadata and posters from
TMDB, backfills missing ids and episode counts, and recomputes every show's status from its episode
progress. It never changes a rating and never un-watches an episode.

### Details page

Clicking a title's name opens a full details page: large poster, overview, genres, runtime, status,
rating, collections, and a scrollable cast list with photos and character names.

For shows, each season is a collapsible section listing every episode with its **own summary**, still
image, air date, runtime, and TMDB rating — with a checkbox to mark it watched, so you can track
progress while reading what each episode is. Season sections show their own watched count, and the
header shows overall episode and season progress.

Bulk actions save clicking through a long show:

- **Watch all episodes** / **Unwatch all** on the show header, covering every aired episode
- **Watch rest of season** on each season, starting from the first *unwatched* episode so it fills
  forward from where you are (it reads **Watch whole season** when nothing is watched yet)
- **Unwatch season** to clear one season, and a "Season complete" note in place of the button when
  there is nothing left to watch

Each of these is a single request that applies the whole range in one write, so marking a 250-episode
show watched is one note update rather than hundreds, and it cannot half-apply. Status updates
automatically: all episodes watched becomes **Watched**, some becomes **Watching**, none becomes
**Planned**.

Everything on this page is fetched from TMDB live rather than stored, so it needs a TMDB key and adds
no weight to your database note.

### Collections

Collections group titles into shared universes and work like **tags** — a title can belong to several
at once. **+ Add to collection** on any row opens a picker listing every collection you have with its
current membership checked, so nothing has to be typed or remembered. A field underneath creates a new
one; typing a name that already exists (in any casing) reuses it rather than making a near-duplicate.

Each tick saves immediately — there is no separate save step to forget.

This is deliberately manual. TMDB cannot supply it: `belongs_to_collection` exists only on movies and
covers narrow film series rather than universes (nothing there joins the MCU's films to its shows),
and TV has no equivalent field at all. So *Game of Thrones* + *House of the Dragon*, or the MCU's
films and series together, only group correctly when you say so.

### Collection groups

Collections can be organised into **groups** — Mood, Franchise, Format, whatever you need — and each
group gets **its own titled dropdown** on the Library tab. Selections across groups combine with AND,
so picking `Franchise: MCU` and `Mood: Comfort` narrows to titles in both.

Define groups on the **Collections** tab in Settings, then assign each collection to one from a
dropdown. A collection with no group appears under **Other**, so nothing is ever hidden by forgetting
to categorise it, and removing a group returns its collections to Other rather than deleting them.

Groups live in settings, not on the titles — a title still just carries collection names — so you can
reorganise your groups freely without rewriting any title data.

Each group's dropdown lists its collections with counts, plus a **None** option showing titles that
are in no collection of *that* group. This is per-group rather than global: `Franchise: None` finds
titles you haven't assigned a franchise, even if they do have a Mood — which is what makes it useful
for spotting gaps in one axis at a time.

Choosing one reveals **✎** (rename) and **×** (remove) beside it. Both sweep the whole library in one
pass: rename updates every title carrying that collection, and remove clears the tag from all of them.
Renaming onto a name that already exists merges the two rather than creating a near-duplicate.

Collections exist only as tags on titles — there is no separate list — so a collection disappears
automatically once no title references it. Removing one never deletes any title; it only clears the
tag.

A **Group by collection** toggle renders rows under collection headers instead. A title in several
collections appears under each — groups overlap by design.

### Genres

Genres are separate from collections and work differently: they come from **TMDB automatically** and
are refreshed by **Refresh**, whereas collections are yours and never touched. They appear as their
own dropdown with counts, scoped the same way — by type, search, and collection, but not by the genre
filter itself.

Genres can be switched off entirely with **Enable Genres** on the Library settings tab. With it off,
the Genre dropdown disappears, genres are hidden on the details page, and any leftover genre filter
stops applying — useful if you would rather categorise everything with your own collections. Nothing
is deleted, so turning it back on restores your genre setup as it was.

Because TMDB assigns a lot of genres, the **Genres** tab in Settings lists every genre in your library
with a checkbox. Unticking one removes it from the filter row; it never changes a title's data.
**Show all** / **Hide all** are there for a fast reset.

A title imported without TMDB metadata has no genres until you run **Refresh**. Note also that TMDB
uses different vocabularies for film and TV — movies get "Science Fiction", shows get
"Sci-Fi & Fantasy" — so both can appear as separate pills.

### Sorting

Sort by **A-Z**, **Recently watched**, **Release date**, **Rating**, **Recently added**, or
**Progress**, with an arrow button to flip direction. Titles missing the sort value (unrated, never
watched, no release year) always sort last in *both* directions, so an empty field never leads the
list.

### Remembered view

Your status filter, type filter, collection filter, genre filter, sort field, sort direction, and
grouping toggle are all saved, so the Library opens the way you left it. They live in the addon's settings note as
hidden fields — persisted, but not shown on the Settings page, since the widget manages them.

The **search box is deliberately not remembered**: a text filter silently hiding most of your library
on load reads as data loss rather than a convenience.

**Add** searches TMDB. The same **All / Movies / TV** chips scope the search: All uses TMDB's
multi-search, while Movies and TV use the dedicated endpoints, which return a full page of one kind
rather than a mixed page filtered down. Switching the chip re-runs the current search immediately.

Results you already track show a green **✓ Added** marker instead of an Add button, so you can see at
a glance what is new. It is matched on any shared id rather than only the TMDB id, so a title
imported from Stremio (which supplies only IMDb ids) is still recognised.

You can also **paste a link instead of searching**. The button switches to **Add** and the title is
added directly, no search step:

```
https://www.themoviedb.org/movie/693134
https://www.themoviedb.org/movie/693134-dune-part-two
https://www.themoviedb.org/tv/95396-severance/season/2
https://www.imdb.com/title/tt15239678/
tt15239678
```

A TMDB link names its own type in the path (`/movie/` or `/tv/`), so it resolves in one call. The
`-slug` suffix TMDB appends, trailing paths like `/season/2`, and query strings are all ignored — only
the numeric id matters. An IMDb link or bare `tt` id is resolved through TMDB's `/find` endpoint.

**Import** is the one-way Trakt and Stremio import described below.

A **Settings** button at the end of the tab row opens the settings page, and a **Back** button there
returns you to the tracker — to the library root you came from, or the addon's launcher note if no
library root is set yet.

## How titles are stored

Every tracked title lives in **one JSON note** titled `Database`, created automatically as a direct
child of your Library Root. Keeping it under the root rather than inside the addon's own tree means
the data travels with the library: move or export the root and your titles come along.

```json
{
    "titles": {
        "tmdb:693134": {
            "tmdbId": "693134", "imdbId": "tt15239678",
            "mediaType": "movie", "title": "Dune: Part Two", "year": "2024",
            "status": "watched", "rating": 9, "lastWatched": "2026-07-20"
        },
        "tmdb:95396": {
            "tmdbId": "95396", "mediaType": "show", "title": "Severance",
            "status": "watching", "watchedEpisodes": "s01e01-e09,s02e01",
            "totalEpisodes": 19
        }
    }
}
```

Each entry is keyed by its strongest known id — TMDB, else IMDb, else Trakt. That key is what makes
imports from different sources converge on one entry instead of duplicating: a title first imported
from Stremio (IMDb id only) is still recognised when Trakt later supplies its TMDB id, because
matching checks *every* shared id, not just the key.

The database note is a plain JSON code note, so you can open, inspect, back up, or hand-edit it. A
blank, malformed, or partially-broken document is treated as empty rather than crashing the widget.

Since titles are JSON entries rather than notes, they are not individually linkable or cloneable, and
Trilium collection views cannot browse them — the widget is the UI.

## Episode tracking

Per-episode progress is a **single compact string** on the show's entry rather than a list of every
episode:

```
"watchedEpisodes": "s01e01-e10,s02e01,s02e03-e05"
```

Consecutive episodes collapse into runs, so a fully-watched ten-season show stays a short string
instead of a 250-element array.

The **Episodes** button on any show opens a season grid where you click individual episodes to
toggle them. Watch status is recomputed automatically: no episodes is `planned`, some is `watching`,
all aired episodes is `watched`.

Episode lists come from TMDB. Imported shows often arrive with only an IMDb id — Stremio supplies
nothing else, and a Trakt entry has no TMDB id if metadata enrichment was off or its fetch failed —
so the TMDB id is resolved from the IMDb id via TMDB's `/find` endpoint and written back to the
entry, making the lookup a one-time cost rather than something that repeats on every open.

## Import

Import is **one-way and additive**: external services are read, and your local edits are never pushed
upstream. Imports only add and update — a title removed from Trakt or Stremio upstream is left
untouched in Trilium, so an external change can never quietly delete your data.

The single exception is the deliberate per-entry **Delete from Trakt** action described under
[Comparing and clearing Trakt history](#comparing-and-clearing-trakt-history), used when migrating off
Trakt. Nothing is ever written to Stremio.

### Trakt

Authorization uses Trakt's device flow: click **Authorize**, and the widget shows a code plus a URL.
Enter the code there in your browser and the widget picks up the approval automatically. Tokens
refresh automatically.

First create a Trakt API app at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications),
then copy two values from it into Settings:

- **Client ID** — the app's public identifier
- **Client Secret** — the separate secret value from the same app

If you get *"Trakt does not recognise this Client ID"*, the usual causes are pasting the Client
Secret into the Client ID field, or pasting only part of the value. Surrounding whitespace is
trimmed automatically, so a stray newline from copying is not the problem.

A *403 Forbidden* means something different: the request was blocked before reaching Trakt. Trakt
[requires a User-Agent header](https://docs.trakt.tv/docs/required-headers) on every call and
Cloudflare rejects requests without one, so this addon always sends one. If you still see a 403,
check whether a proxy sits between your Trilium server and `api.trakt.tv`.

Trakt import brings in watched movies and full per-episode history for shows.

### Stremio

Enter your Stremio email and password in Settings, then click **Login** on the Import tab. The
password is discarded once an auth key is obtained.

Stremio only records your *current position* per show rather than a full history, so episodes up to
that point are marked watched.

### Migrating off Trakt

**Archive everything** on the Import tab is for leaving Trakt. Regular **Import from Trakt** only
reads `/sync/watched`, which is *aggregate* state — it has no individual watch timestamps, no ratings,
no watchlist, and no collection. Deleting your Trakt data after only that import loses all of it.

Archive fetches every sync endpoint, following pagination to the last page:

| Endpoint | What it holds |
|---|---|
| `/sync/watched/{movies,shows}` | Aggregate watched state and play counts |
| `/sync/history/{movies,episodes}` | **Every individual watch, with its `watched_at` timestamp** |
| `/sync/ratings/{movies,shows,seasons,episodes}` | Your ratings |
| `/sync/watchlist/{movies,shows}` | What you planned to watch |
| `/sync/collection/{movies,shows}` | What you own |

Trakt's **raw, unmodified responses** are saved to a `Trakt Archive` JSON note beside your library's
`Database` note. That is the important part: even if the mapping into the library misses a field, the
original data is still there to re-derive from later.

On top of that, watch data is imported into your library as usual, and Trakt ratings are applied to
matching titles (existing ratings are kept unless you enable **Let Imports Overwrite My Ratings**).

Suggested order:

1. Click **Archive everything** and wait for it to finish.
2. Check the per-endpoint counts it reports against what Trakt shows you. If any endpoint says
   **failed**, fix that first — the report says explicitly not to delete yet.
3. Open the `Trakt Archive` note and confirm it looks complete.
4. Back up your Trilium data.
5. Only then remove your data on Trakt's own site.

### Comparing and clearing Trakt history

**Compare with Trakt** fetches your full Trakt watch history and shows it against your Trilium
library, newest first. Each row is marked:

- **✓** — that exact watch is recorded in Trilium (for an episode, that specific season/episode is
  marked watched; for a movie, the title is marked watched)
- **!** — not in Trilium yet

Rows marked **!** get an **Import** button that records just that one watch in Trilium — an episode is
merged into its show's existing progress, never replacing it — after which the row flips to ✓ and can
be deleted. This means you can work straight down the list without leaving the view.

Rows marked ✓ get a **Delete from Trakt** button that removes **that single watch** from Trakt. Rows
marked **!** cannot be deleted — the button is disabled *and* the backend refuses, so an unsaved watch
can't be lost even by a crafted request.

Deletion targets Trakt's own **history id**, which is the correct way to remove one play: removing by
title + timestamp is ambiguous, because Trakt does not guarantee that pair is unique, and could clear
more plays than intended. There is no bulk delete, by design.

**Trakt history removal is permanent — there is no undo on Trakt's side.** Archive first, verify the
counts, back up Trilium, then delete. The watch remains in Trilium either way.

This is the only place the addon writes to an external service; everything else is read-only, and
Stremio is never written to at all.

### Import safety

Repeated imports are safe and idempotent:

- **Imports only ever add and update — they never delete.** A title in your library that the source
  doesn't return is left completely untouched, so removing something from Trakt and re-importing
  does not remove it here, hand-added titles always survive, and an empty or failed response cannot
  wipe your library. The only thing that deletes a title is the **×** button.
- Titles are matched on any shared id (TMDB, IMDb, or Trakt), so two sources converge on one entry
  instead of creating duplicates.
- Episode progress is **merged**, never replaced — an episode you marked watched locally is never
  un-marked by an import.
- Your ratings and watch status are never overwritten unless you enable the matching Import setting.
- An import reads the database once, applies every change in memory, and writes once at the end, so
  a large import is a single note write and cannot half-apply if something fails partway.

## Settings

| Tab | Settings |
|-----|----------|
| **Library** | Library root note, status for new titles, poster size |
| **TMDB** | API key |
| **Trakt** | Client ID and secret; tokens are filled in automatically |
| **Stremio** | Email and password; auth key is filled in automatically |
| **Import** | Whether imports set watched status, fetch TMDB metadata, and may overwrite ratings |

## Migrating from stremio-sync@beatlink

The old addon wrote a flat HTML table into a note of your choosing; it kept no structured data, so
there is nothing to migrate. Set up Stremio on the Import tab here and run an import to rebuild your
library, then uninstall `stremio-sync@beatlink`. Its target note is left untouched — delete it
yourself when you no longer want the old table.
