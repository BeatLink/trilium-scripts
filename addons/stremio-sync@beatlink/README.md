# Stremio Sync

Syncs your Stremio watch history into a Trilium note. Logs into your Stremio account and
writes a table of watched movies/series (title, type, last watched date, progress, times
watched) into a note of your choosing.

## How it works

The addon is a render widget (`view.jsx`) backed by a backend `customRequestHandler`
(`custom/stremioSync`) that talks to Stremio's public API (`https://api.strem.io`) over
plain HTTPS — the same API Stremio's own apps use to sync your library across devices.

- **Login** — exchanges your Stremio email/password for an auth key (stored in Settings;
  the password itself is not persisted after a successful login).
- **Sync Now** — fetches your full library (`datastoreGet`/`libraryItem`) and rewrites the
  target note's content as an HTML table, replacing whatever was there before.

Sync also runs automatically once when the widget loads, if enabled in Settings and
already logged in.

## Setup

1. Open the addon's Settings page and fill in your Stremio email/password, and pick a
   note under **Sync Into Note** — its content will be overwritten on every sync.
2. Open the addon's widget and click **Login**.
3. Click **Sync Now**, or just reload — auto-sync runs on load by default.

## Notes

- This uses Stremio's undocumented but stable account API (the same one `stremio-web`
  and the desktop app use for library sync), not a local file — no access to the Stremio
  app/device itself is required.
- Items marked `removed` or of type `other` are excluded from the table.
