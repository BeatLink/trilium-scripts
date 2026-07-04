# Notification Library

Shared library for sending desktop notifications from TriliumNext scripts. Clicking a notification navigates to the associated note. Ships two exports, since the underlying `Notification` API only exists in the frontend:

## Frontend usage (`lib` export)

For scripts that already run in a frontend context (e.g. `"run": "frontendStartup"`, like [`notifications@beatlink`](../notifications@beatlink/)). Declare this addon as a dependency and clone the `lib` export as a child — `require()` it by its note title, `libNotification.js` (Trilium's bundler resolves `require()` by exact note title, so this library uses a fully-qualified title to avoid colliding with any other library's globals):

```js
const { sendNotification } = require("libNotification.js");
await sendNotification("Note Title", "Optional body text", noteId);
```

## Backend usage (`backend` export)

For `customRequestHandler`/other backend scripts that need to fire a notification in response to something happening server-side (e.g. [`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/)'s countdown timer). Clone the `backend` export as a child instead — `require()` it by its title, `libNotificationBackend.js`; it internally does the `runOnFrontend` hop for you:

```js
const { sendNotification } = require("libNotificationBackend.js")
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
