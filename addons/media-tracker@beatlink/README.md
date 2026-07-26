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

## Import

Import is strictly **one-way**: external services are read, and nothing is ever written back to
them. No write scopes are requested, so no local edit can be pushed upstream by accident.

### Trakt

Authorization uses Trakt's device flow: click **Authorize**, and the widget shows a code plus a URL.
Enter the code there in your browser and the widget picks up the approval automatically. You need a
Trakt API app ([trakt.tv/oauth/applications](https://trakt.tv/oauth/applications)) for the client ID
and secret. Tokens refresh automatically.

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
