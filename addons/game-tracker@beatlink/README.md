# Game Tracker

A video game tracker for TriliumNext. Your whole library lives in **one JSON note** under a library
root you choose, so it is a single note you can back up, inspect, or hand-edit — and the library root
itself becomes the tracker UI.

The games counterpart to [`media-tracker@beatlink`](../media-tracker@beatlink), which tracks films and
TV. The two are independent addons with separate libraries and settings.

## Setup

1. Install and enable the addon.
2. Optionally set up metadata sources on the **Sources** tab. You can skip this entirely —
   Steam, GOG, and Lutris need no key at all. See [Metadata sources](#metadata-sources).
3. Create a note to hold your library (anywhere in your tree), then pick it at the top of the
   **Library** tab in Settings. This is required — every tracked game is created as a child of it.
4. Optionally set up Steam on the **Steam** tab to import your owned games.

Picking a Library Root wires it up automatically: the note is converted to a **render note** pointing
at the tracker widget and given a joystick icon, so opening it in your tree shows the tracker itself.
Choosing a different note reverts the old one back to a plain text note, and clearing the setting
reverts it without selecting a replacement.

## Metadata sources

Covers, genres, platforms, and summaries come from an **ordered list of sources**, configured on the
**Sources** tab. They are consulted in order and merged **field by field**: the first source that
supplies a value wins that field, and anything it leaves empty falls through to the next.

So one game can end up with IGDB's platforms, SteamGridDB's cover art, and Steam's summary — which is
usually better than any single source alone. Reorder to change precedence; untick to disable.

| Source | Key needed | Strengths | Gaps |
|---|---|---|---|
| **IGDB** | Twitch app + **2FA** | Fullest metadata: storyline, game modes, console platforms | 2FA blocks registration for some |
| **RAWG** | Email signup | Broad coverage incl. older and non-Steam titles | No storyline or game modes |
| **Steam** | **None** | Descriptions, genres, developers, screenshots, Metacritic | No console platforms; Steam titles only |
| **GOG** | **None** | DRM-free and older PC games Steam never carried | No console platforms; no summaries |
| **Lutris** | **None** | Console platforms, descriptions; bridges Steam/GOG ids | Community-edited, so uneven |
| **SteamGridDB** | Free signup | Best cover art of any source | **Art only** — no metadata at all |
| **TheGamesDB** | Free login | Best retro and console coverage | **Monthly request quota** |

**Three sources need no key whatsoever** (Steam, GOG, Lutris), so the tracker works fully with no
setup at all. Any source whose key you have not set is skipped automatically, so leaving one enabled
is harmless.

### Ordering and cost

Order is not just preference — it controls cost. Once every field is filled, the chain **stops
early**, so sources further down are never consulted. That is why the two key-requiring sources ship
last, and why **TheGamesDB ships disabled**: it has a monthly quota, and placed last it is only ever
asked for fields nothing else could supply.

Bulk operations shrink the list as they go, too: each source is only asked about the titles still
missing something, so a large import spends its later sources on a handful of stragglers rather than
the whole library.

### IGDB credentials

IGDB is owned by Twitch, so it authenticates as a Twitch application rather than with a simple API
key:

1. Sign in at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). **Two-factor
   authentication must be enabled on the Twitch account** — app registration is blocked without it.
2. Register an application. The OAuth Redirect URL is unused by IGDB — put `http://localhost`.
   **Client Type must be Confidential**, otherwise no client secret can be generated.
3. Copy the **Client ID**, generate a **Client Secret**, and paste both into Settings → Sources.

The addon exchanges those for an access token itself and renews it automatically a day before it
expires. IGDB is free for non-commercial use.

**If you cannot enable Twitch 2FA**, simply leave IGDB disabled — the remaining six sources cover PC
gaming comprehensively, and three of them need no key at all.

### RAWG credentials

Sign up at [rawg.io/apidocs](https://rawg.io/apidocs) with an email address and paste the key into
Settings → Sources. No OAuth, no application registration, no two-factor requirement. The free tier
covers 20,000 requests a month.

### SteamGridDB credentials

Free key from [steamgriddb.com/profile/preferences/api](https://www.steamgriddb.com/profile/preferences/api)
after a plain signup. SteamGridDB contributes **cover art only** — no genres, summaries, or
platforms — so enable it only if you want better artwork than the general sources provide. Place it
above the others to have its art win.

### TheGamesDB credentials

Log in at [thegamesdb.net](https://thegamesdb.net) and open **API Key**. Its retro and console
coverage is the best of any source here, but it has a **monthly request quota**, so it ships last and
disabled.

Its genres and platforms arrive as numeric ids rather than names; the addon fetches those lookup
tables **once** and caches them, so resolving them costs no extra quota per game.

Use **Check all sources** on the Import tab to see which sources are working, and how much
TheGamesDB quota remains.

### Steam credentials

Two things are needed, both on the **Steam** tab in Settings:

- a **Steam Web API key**, free from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
- your **SteamID64**, the 17-digit numeric id

Steam shows you a profile name, not that number, so the lookup box lower down that tab converts one
for you: paste your profile URL (`https://steamcommunity.com/id/yourname`) or just the vanity name,
press **Look up**, and the resolved id is saved. A `/profiles/765611...` URL is recognised directly. **Check
connection** then confirms the whole setup by reporting how many games Steam returns.

Your Steam profile's **Game details** privacy must be set to Public. When it is not, Steam answers
with an empty list rather than an error, so the addon reports that specifically rather than showing
you an empty library.

## Using it

The widget has three tabs.

**Library** shows everything you track, with filters that compose:

- a **search box** that narrows by title as you type (case-insensitive substring)
- **Status**, **Platform**, **Collection**, and **Genre** dropdowns

Every option carries its own count, and each dropdown is scoped by the filters before it but never by
itself — so selecting one option never zeroes out the others, and a count always tells you how many
rows that choice would show. Each status carries its own colour, which you choose — see
[Statuses](#statuses).

Each row has a status dropdown, a ★ rating box (0-10, blank for unrated), a **playtime** button, and a
**×** to remove the game. A running total of playtime across whatever is currently filtered sits
beside the sort controls, so narrowing to a series or a genre answers "how long did I spend on this"
directly.

**Refresh** runs a housekeeping sweep over the whole library: it re-fetches metadata and covers from
your configured sources and links any unlinked games by Steam appid or title. It never changes a
rating, a status, or a playtime.

### Statuses

Statuses are **fully customizable** on the Statuses tab in Settings. Add, rename, recolour, reorder,
or remove them freely. The addon ships four — **Backlog**, **Playing**, **Beaten**, **Dropped** — but
they are only a starting point.

A game stores a status **id**, not its name, so renaming a status never touches your library.

#### Roles

Each status carries a **role**, which is how imports know what a status *means* without depending on
what you called it:

| Role | Meaning |
|---|---|
| Backlog | Not started |
| Playing | In progress |
| Done | Finished |
| Abandoned | Stopped |
| None | Manual only — no import ever sets it |

This indirection is the point. Rename *Beaten* to *Finished*, or add your own *Wishlist* and
*Shortlist* both carrying the Backlog role, and every import keeps working — they target the role,
never the name. Where several statuses share a role, the first in your order wins.

Give a status the **None** role to make it purely manual: useful for something like *Favourite* that
you only ever apply yourself and never want an import to touch.

If your set has no status for a role an import needs, it degrades sensibly rather than failing —
a Done with no Done-role status falls back to Playing, so the signal is not lost entirely.

**Status For New Games** on the same tab picks what a hand-added game gets. Left automatic, it always
follows your first Backlog-role status, so it keeps working even if you reorganise later.

#### Removing a status

Removing a status **never changes a game that still holds it**. Those games keep it, the tracker shows
it marked *(removed)* in dropdowns and filters, and you reassign them whenever you like. Silently
rewriting them would destroy your own classification, so the addon refuses to.

For the same reason, an import never overwrites a removed status: as far as the addon is concerned it
is a deliberate choice you made, not corruption.

### Why nothing is auto-completed

Unlike the TV tracker — where watching every episode unambiguously means a show is finished — a game
has no equivalent signal. Two hundred hours in a roguelike says nothing about whether you have
finished it, and thirty minutes in a short indie game might be the whole thing. So **status is never
derived from playtime**. An import will move a game out of the backlog into a Playing-role status
once Steam shows it has been played, and that is as far as it goes: marking something finished is
always your decision.

### Playtime

Playtime is stored in **minutes** (what Steam reports) and shown in hours. The button on each row
edits it directly — enter hours, decimals allowed — so a game played on a console or through another
launcher still carries a real number.

Imports **never lower a stored playtime**. Steam's figure is authoritative for Steam, but time played
elsewhere or entered by hand would otherwise be silently discarded, so the larger of the two always
wins.

### Details page

Clicking a game's name opens a full details page: large cover, summary, storyline, developers and
publishers, genres, platforms, game modes, IGDB's aggregate rating alongside your own, a scrollable
row of screenshots, and a list of similar games. Links out to IGDB and — when the game came from
Steam — to its Steam store page.

Everything here is fetched live from your metadata sources rather than stored, so it adds no weight
to your database
note.

### Collections

Collections group games into series and themes and work like **tags** — a game can belong to several
at once. **+ Add to collection** on any row opens a picker listing every collection you have with its
current membership checked, so nothing has to be typed or remembered. When you have collection groups,
the picker is split into a labelled section per group — Series, Mood, and so on — each edited
separately. A field underneath creates a new collection; typing a name that already exists (in any
casing) reuses it rather than making a near-duplicate, and a newly created one appears under
**Ungrouped** until you file it into a group in Settings.

Each tick saves immediately — there is no separate save step to forget.

This is deliberately manual. IGDB does have `franchises` and `collections` fields, but they are
inconsistently populated and reflect publisher marketing rather than how you think about your library,
so groupings like "Comfort games" or "2024 backlog" only exist when you say so.

### Collection groups

Collections can be organised into **groups** — Series, Mood, Format, whatever you need — and each
group gets **its own titled dropdown** on the Library tab. Selections across groups combine with AND,
so picking `Series: Souls` and `Mood: Comfort` narrows to games in both.

Define groups on the **Collections** tab in Settings. Each group gets its own block listing its
collections, with a text box to add another **directly into that group** — so a collection is created
where it belongs rather than being filed afterwards. A collection can still be moved between groups
with its dropdown.

A collection created this way exists straight away, before any game uses it, and is marked *unused*
until one does. Collections that belong to no group appear in an **Ungrouped** block, which is omitted
entirely when empty. Removing a group moves its collections there rather than deleting them.

Groups live in settings, not on the games — a game still just carries collection names — so you can
reorganise your groups freely without rewriting any game data.

Each group's dropdown lists its collections with counts, plus a **None** option showing games that are
in no collection of *that* group. This is per-group rather than global: `Series: None` finds games you
haven't assigned to a series, even if they do have a Mood — which is what makes it useful for spotting
gaps in one axis at a time.

Choosing one reveals **✎** (rename) and **×** (remove) beside it. Both sweep the whole library in one
pass: rename updates every game carrying that collection, and remove clears the tag from all of them.
Renaming onto a name that already exists merges the two rather than creating a near-duplicate.

Collections exist only as tags on games — there is no separate list — so a collection disappears
automatically once no game references it. Removing one never deletes any game; it only clears the tag.

A **Group by collection** toggle renders rows under collection headers instead. A game in several
collections appears under each — groups overlap by design.

### Genres and platforms

Both come from your **metadata sources automatically** and are refreshed by **Refresh**, whereas
collections are yours and never touched. Each appears as its own dropdown with counts, scoped the same way — by the filters
before it, but not by itself.

Genres can be switched off entirely with **Enable Genres** on the Library settings tab. With it off,
the Genre dropdown disappears, genres are hidden on the details page, and any leftover genre filter
stops applying. Nothing is deleted, so turning it back on restores your setup as it was.

The **Genres** tab in Settings lists every genre in your library with a checkbox. Unticking one
removes it from the filter row; it never changes a game's data. **Show all** / **Hide all** are there
for a fast reset.

The platform filter is a useful way to separate a PC library from console titles, since a game
imported from Steam still lists every platform IGDB knows it released on.

### Sorting

Sort by **A-Z**, **Recently played**, **Release date**, **Rating**, **Playtime**, or **Recently
added**, with an arrow button to flip direction. Games missing the sort value (unrated, never played,
no release year) always sort last in *both* directions, so an empty field never leads the list.

### Remembered view

Your status filter, platform filter, collection filters, genre filter, sort field, sort direction, and
grouping toggle are all saved, so the Library opens the way you left it. They live in the addon's
settings note as hidden fields — persisted, but not shown on the Settings page, since the widget
manages them.

The **search box is deliberately not remembered**: a text filter silently hiding most of your library
on load reads as data loss rather than a convenience.

### Adding games

**Add** searches IGDB. Results you already track show a green **✓ Added** marker instead of an Add
button, so you can see at a glance what is new. It is matched on any shared id rather than only the
IGDB id, so a game imported from Steam is still recognised.

You can also **paste a link instead of searching**. The button switches to **Add** and the game is
added directly, no search step:

```
https://www.igdb.com/games/hades
https://store.steampowered.com/app/1145360/Hades/
https://steamcommunity.com/app/1145360
1145360
```

An IGDB link is resolved by its slug. A Steam link or bare appid is looked up in IGDB's
`external_games` index first so the game gets full metadata; if IGDB has never heard of it, the
addon falls back to Steam's own store data rather than refusing.

**Import** covers the one-way Steam import and the file import, both described below.

A **Settings** button at the end of the tab row opens the settings page, and a **Back** button there
returns you to the tracker — to the library root you came from, or the addon's launcher note if no
library root is set yet.

## How games are stored

Every tracked game lives in **one JSON note** titled `Database`, created automatically as a direct
child of your Library Root. Keeping it under the root rather than inside the addon's own tree means
the data travels with the library: move or export the root and your games come along.

```json
{
    "games": {
        "igdb:113112": {
            "igdbId": "113112", "steamAppId": "1145360",
            "title": "Hades", "year": "2020",
            "summary": "A rogue-like dungeon crawler...",
            "cover": "https://images.igdb.com/igdb/image/upload/t_cover_big/co39vc.jpg",
            "genres": "Adventure, Indie, Role-playing (RPG)",
            "platforms": "PC (Microsoft Windows), Nintendo Switch",
            "status": "beaten", "rating": 9,
            "playtime": 5220, "lastPlayed": "2026-03-14",
            "addedAt": "2026-01-02",
            "collections": ["Roguelikes", "Comfort"]
        }
    }
}
```

The key is the game's strongest known id — the IGDB id when there is one, otherwise the Steam appid.
Keying by identity is what makes repeated imports converge on one entry instead of duplicating.

`playtime` is minutes. `status` is a **status id** — a key of the `statuses` registry in Settings.
The shipped ids are `backlog`, `playing`, `beaten`, and `dropped`, but you can add your own, and a
game keeps whatever id it holds even if that status is later removed.

## Import

Import is **one-way**. Games and playtime are copied into Trilium; nothing is ever written back to
Steam or IGDB. Both are strictly read-only — there is no endpoint in this addon that writes to either.

Imports are **additive**: they only ever add and update games, never remove them. A game removed from
your Steam account upstream is left untouched here, so an external change can't quietly delete your
Trilium data.

Each import **reads the database once and writes once**, so a 900-game library is a single note write
that cannot half-apply.

### How Steam and IGDB are combined

Steam knows appids and playtime. IGDB knows everything else. So the import:

1. fetches your owned games from Steam (`GetOwnedGames`, with playtime and last-played time)
2. resolves those appids to IGDB ids **in bulk** through IGDB's `external_games` index, 200 at a time
3. fetches IGDB metadata for the matches, again in bulk

Bulk matching is what keeps this practical: a 900-game library takes a handful of IGDB requests rather
than 900, which matters because IGDB's rate limit is 4 requests per second. Requests are spaced to
stay inside it.

A game IGDB has never heard of is **still imported**, keyed by its Steam appid, with the name and
playtime Steam supplied — it simply has no cover or genres until IGDB learns about it. Running
**Refresh** later links any such game once a match exists.

IGDB's title wins over Steam's where both are known: Steam titles often carry edition and trademark
noise ("Game of the Year Edition", "™") that IGDB's canonical name does not.

### What is preserved

- **Your ratings** are never overwritten unless you tick *Let Imports Overwrite My Ratings*.
- **Playtime never moves backwards** — the larger of the stored and incoming value wins.
- **Last played never moves backwards** either.
- **A Done-role status is never set by a Steam import.** Playtime cannot tell whether a game was
  finished. (A *file* import may set one, because there you explicitly filed the game as played.)
- Metadata fields are only overwritten when the import actually supplies them, so a Steam-only row
  can't blank out metadata an earlier IGDB-backed run filled in.

### Options

- **Import Only Played Games** skips owned games with no recorded playtime. Useful when a large bundle
  library would otherwise flood the tracker with games you have never launched.
- **Fetch IGDB Metadata On Import** can be turned off for a faster, metadata-free import; run
  **Refresh** afterwards to fill it in.
- **Imports Set Playing Status** moves played games out of the backlog. Off leaves status entirely
  alone.

## Import from a file

**Import → Import from a file** loads a library from a file instead of an API. It handles an IGDB
data export, or any CSV/JSON list of games.

### IGDB data export

IGDB will email you a ZIP of everything it holds on your account. Unzip it and pick the
`index.html` inside — that single file is the whole export.

The addon reads your **Want to Play**, **Playing**, and **Played** lists, plus any ratings, and maps
them onto tracker statuses:

| In the export | Becomes |
|---|---|
| Want to Play | Backlog role |
| Playing | Playing role |
| Played | Done role |
| Entry marked *Completed* / *Finished* | Done role |
| Entry marked *Abandoned* | Abandoned role |
| Entry marked *Currently playing* | Playing role |

A per-entry status always wins over the list it sits in, so an *Abandoned* game inside **Played**
takes the Abandoned role rather than Done. A game appearing in more than one list is imported once,
taking the most definite status of the two.

Note that these map onto **roles**, not fixed names — so whatever you have called your own
Done-role status is what an imported *Completed* game actually gets.

Ratings are converted from IGDB's 0-100 scale to the tracker's 0-10.

**The export contains no game ids — only titles.** Every row therefore has to be matched against your
metadata sources by name, which is a guess, which is why the import happens in two steps.

### Preview before writing

Choosing a file never writes anything. The addon parses it, matches every title, and then reports:

- how many games it found, and which lists they came from
- how many matched the provider, and how many did not
- how many are already in your library
- a scrollable list of the matches, each showing the provider's own spelling when it differs from
  the file's — so a wrong match is visible *before* it is committed

Only then does **Import N games** write anything. Unmatched rows are skipped entirely: with no id
there is nothing to key on. They are usually titles the provider spells differently, or genuinely
does not have — add those by hand from the Add tab.

A **File each game under its list as a collection** option files imported games under collections
named after their source lists, so the export's own organisation survives.

### CSV and JSON

Any CSV with a header row works. Column names are matched flexibly, so an export from another tracker
or a hand-made spreadsheet usually imports without editing:

| Field | Accepted column names |
|---|---|
| Title (required) | `title`, `name`, `game`, `game name` |
| Status | `status`, `state`, `progress`, `list` |
| Rating | `rating`, `score`, `my rating` |
| Playtime | `playtime`, `hours`, `hours played`, `time played` |
| Last played | `lastplayed`, `last played`, `date` |
| IGDB id | `igdbid`, `igdb id`, `igdb` |
| Steam appid | `steamappid`, `appid`, `steam appid` |
| Platform | `platform`, `platforms` |

Quoted fields, commas inside titles, and escaped quotes are all handled. Ratings are accepted on
either a 0-10 or 0-100 scale (anything above 10 is treated as a percentage), and playtime is read in
hours. Status values are matched loosely — `Completed`, `beaten`, `100%`, `finished` all become
the Done role; `abandoned`, `quit`, `shelved` become Abandoned — with anything unrecognised falling
back to Backlog rather than being dropped.

JSON works the same way: a bare array of objects, or an object containing one, with the same field
names.

**A row carrying an `igdbId` or `steamAppId` skips title matching entirely** and is matched on the id,
which is exact. If you are hand-building a file, including ids is worth the effort.

### Scheduled import

**Auto-Import From Steam** runs the same import on a schedule. Trilium schedules no finer than hourly,
so the script wakes each hour and returns immediately unless **Hours Between Auto-Imports** has
elapsed — 1 imports hourly, 24 once a day.

It uses exactly the same code path as the button, so a scheduled run behaves identically. Its outcome
is reported on the Import tab, since a background run would otherwise be invisible. A failure still
records the timestamp, so a persistently broken source doesn't retry every hour forever.

## Notes and limitations

- **IGDB requests must go through the backend.** IGDB does not allow requests from browsers (no CORS),
  so every lookup is made by the addon's backend script. This is invisible in use, but it is why the
  addon has a backend component at all.
- **The IGDB token is an app token.** There is no user account involved and no per-user authorization
  step — the Client ID and Secret are exchanged for a token that the addon renews on its own.
- **IGDB requires Twitch 2FA.** This is Twitch's rule for registering any application, not something
  the addon can work around. Use RAWG if that blocks you.
- **Title matching is a guess.** A file with no ids is matched by name, and a game whose title the
  provider spells differently will not match. This is why the file import previews before writing,
  and why unmatched rows are skipped rather than guessed at.
- **Only IGDB has bulk endpoints.** Every other source needs one request per game, so a large import
  is noticeably slower when IGDB is disabled.
- **Source ids are not interchangeable.** A game stores the id of whichever source is *primary* (the
  first one that supports id lookups). Reordering so a different source leads is supported — Refresh
  re-links by Steam appid or title — but it is a re-match, not a translation, so a game the new
  primary does not have will end up unlinked.
- **SteamGridDB supplies art only.** It contributes `cover` and nothing else; it can never fill a
  genre, platform, or summary.
- **TheGamesDB has a monthly quota.** It ships last and disabled for that reason. Enabling it and
  moving it up the order will spend quota quickly on a large library.
- **Steam only reports totals.** There is no per-session history in the API, so `playtime` is a running
  total, not a log of sessions.
- **Non-Steam launchers have no API import.** GOG, Epic, and console libraries have no equivalent
  read-only API available here. Export them to CSV and use the file import, or add them by hand.
