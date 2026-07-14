# Agenda My Day

The "My Day" focus half of the [Agenda](https://github.com/BeatLink/trilium-scripts) system: a focus
strip (a manual countdown timer) that appears inline at the top of one note's detail pane — whichever
note you designate as your **My Day Note** in the Agenda Editor (defaults to the shipped "My Day"
note this addon installs). It renders nothing on any other note.

While the My Day note is open it also runs two optional background loops:

- **Add Tasks When Due** — files any task starting now onto the My Day note as a to-do.
- **Send Due Notifications** — sends a notification for tasks that are due.

Both are toggled by flags on the Agenda Editor's **My Day** tab, along with the timer's **Enable
Timer Sounds** flag and the **My Day Note** picker.

## Requires Agenda Overview

This addon reads the **shared Agenda configuration** owned by `agenda-overview@beatlink` — it does
not ship its own. On mount, `agendaSettings.jsx` finds that config by searching for the
**`#agendaConfig`** label (see the [Agenda Overview README](../agenda-overview@beatlink/README.md)),
giving it the My Day note id, the timer/loop flags, and the profile context the two loops act on
(they append/notify based on the same profiles and searches the Overview uses).

Install **Agenda Overview** for this widget to have a configuration to read; without a `#agendaConfig`
note present, the widget resolves no settings and does nothing. The **My Day** tab that configures
this widget lives in Agenda Overview's Agenda Editor.
