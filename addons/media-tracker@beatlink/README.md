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

**Library** shows everything you track, with three stacked filters that compose:

- a **search box** that narrows by title as you type (case-insensitive substring)
- **All / Movies / TV** chips
- **status** chips (Planned, Watching, Watched, Dropped)

The status counts are scoped to the type and search filters above them, so a count always tells you
how many rows clicking it would actually show. Status is colour-coded throughout: grey for planned,
blue for watching, green for watched, red for dropped.

Each row has a status dropdown, a ★ rating box (0-10, blank for unrated), an **Episodes** toggle for
shows, and a **×** to remove the title. A show's row shows its progress — episodes watched and
seasons started — and expanding it shows episodes watched and seasons *completed*.

**Refresh** runs a housekeeping sweep over the whole library: it re-fetches metadata and posters from
TMDB, backfills missing ids and episode counts, and recomputes every show's status from its episode
progress. It never changes a rating and never un-watches an episode.

### Collections

Collections group titles into shared universes and work like **tags** — a title can belong to several
at once. Use **+ Add to collection** on any row and type comma-separated names, with autocomplete
from collections you already use.

This is deliberately manual. TMDB cannot supply it: `belongs_to_collection` exists only on movies and
covers narrow film series rather than universes (nothing there joins the MCU's films to its shows),
and TV has no equivalent field at all. So *Game of Thrones* + *House of the Dragon*, or the MCU's
films and series together, only group correctly when you say so.

The toolbar offers a **Collection** filter (including an **Untagged** option for titles with none) and
a **Group by collection** toggle that renders rows under collection headers. A title in several
collections appears under each — groups overlap by design.

### Sorting

Sort by **A-Z**, **Recently watched**, **Release date**, **Rating**, **Recently added**, or
**Progress**, with an arrow button to flip direction. Titles missing the sort value (unrated, never
watched, no release year) always sort last in *both* directions, so an empty field never leads the
list.

**Add** searches TMDB. The same **All / Movies / TV** chips scope the search: All uses TMDB's
multi-search, while Movies and TV use the dedicated endpoints, which return a full page of one kind
rather than a mixed page filtered down. Switching the chip re-runs the current search immediately.

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

Import is strictly **one-way**: external services are read, and nothing is ever written back to
them. No write scopes are requested, so no local edit can be pushed upstream by accident.

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

### Import safety

Repeated imports are safe and idempotent:

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
