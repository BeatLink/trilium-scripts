# Media Tracker

A movie and TV tracker for TriliumNext. Every title you track is a **real Trilium note**, so your
library works with Trilium's own search, links, cloning, and collection views — not just inside this
addon's widget.

Replaces [`stremio-sync@beatlink`](../stremio-sync@beatlink), which this addon absorbs.

## Setup

1. Install and enable the addon.
2. Open its Settings page and paste a **TMDB API key** (free, from
   [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)). This powers search,
   posters, and episode lists.
3. Create a note to hold your library (anywhere in your tree), then set it as **Library Root** in
   Settings. This is required — every tracked title is created as a child of it.
4. Optionally set up Trakt and/or Stremio on the Import tab.

To browse the library as a board, set these labels on your library root note:

```
#viewType=board
#board:groupBy=watchStatus
```

A table sorted by `#rating` or a gallery of `#poster` images works the same way — these are ordinary
Trilium collection views over ordinary notes, so the addon does not need to be involved.

## How titles are stored

Each movie or show is one note under your library root, carrying its state as labels:

| Label | Meaning |
|-------|---------|
| `#mediaTitle` | Marker present on every tracked note |
| `#mediaType` | `movie` or `show` |
| `#watchStatus` | `planned`, `watching`, `watched`, `dropped` |
| `#rating` | Your rating, 0-10 |
| `#tmdbId`, `#imdbId`, `#traktId` | Identity, used to match imports to existing notes |
| `#year`, `#runtime`, `#genres`, `#poster` | Metadata from TMDB |
| `#lastWatched` | ISO date |
| `#watchedEpisodes` | Episode progress for shows (see below) |
| `#totalEpisodes` | Aired episode count, for progress display |

Because these are ordinary notes with ordinary labels, you can point any Trilium collection view at
the library root — a board grouped by `watchStatus`, a table sorted by `#rating`, or a gallery of
`#poster` images all work, with no involvement from this addon. See [Setup](#setup) for the labels.

## Episode tracking

Per-episode progress lives in a **single label** on the show note rather than one note per episode:

```
#watchedEpisodes = s01e01-e10,s02e01,s02e03-e05
```

Consecutive episodes collapse into runs, so a fully-watched ten-season show stays a short string.
This keeps a 250-episode show as *one* note in your tree instead of 250, which matters for both
tree size and search speed.

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

- Titles are matched by id (`#tmdbId`, then `#imdbId`, then `#traktId`), so two sources converge on
  one note instead of creating duplicates.
- Episode progress is **merged**, never replaced — an episode you marked watched locally is never
  un-marked by an import.
- Your ratings are never overwritten unless you enable **Let Imports Overwrite My Ratings**.

## Settings

| Tab | Settings |
|-----|----------|
| **Library** | Library root note, status for new titles, poster size |
| **TMDB** | API key |
| **Trakt** | Client ID and secret; tokens are filled in automatically |
| **Stremio** | Email and password; auth key is filled in automatically |
| **Import** | Whether imports set watched status, fetch TMDB metadata, and may overwrite ratings |

## Migrating from stremio-sync@beatlink

The old addon wrote a flat HTML table into a note of your choosing; it did not create per-title
notes, so there is no note structure to migrate. Set up Stremio on the Import tab here and run an
import to rebuild your library as real notes, then uninstall `stremio-sync@beatlink`. Its target
note is left untouched — delete it yourself when you no longer want the old table.
