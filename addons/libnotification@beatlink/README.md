# Notification Library

Shared library for sending desktop notifications from TriliumNext scripts. Clicking a notification navigates to the associated note. Ships two exports, since the underlying `Notification` API only exists in the frontend:

## Frontend usage (`lib` export)

For scripts that already run in a frontend context (e.g. `"run": "frontendStartup"`, like [`notifications@beatlink`](../notifications@beatlink/)). Declare this addon as a dependency and clone the `lib` export as a child — TAM makes it available as a bundle global named after its note title, `libnotification`:

```js
const { sendNotification } = libnotification;
await sendNotification("Note Title", "Optional body text", noteId);
```

## Backend usage (`backend` export)

For `customRequestHandler`/other backend scripts that need to fire a notification in response to something happening server-side (e.g. [`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/)'s countdown timer). Clone the `backend` export as a child instead — it's available as the global `libnotificationBackend`, and internally does the `runOnFrontend` hop for you:

```js
const { sendNotification } = libnotificationBackend
sendNotification("Note Title", "Optional body text", noteId)
```

Don't clone both exports into the same note — pick whichever matches the note's own execution
context (frontend vs backend).

## API

### `sendNotification(title, body, noteId)`

Same signature on both exports:

| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `title`   | string | Notification title                       |
| `body`    | string | Notification body text (can be empty)    |
| `noteId`  | string | Note to activate when notification is clicked |
