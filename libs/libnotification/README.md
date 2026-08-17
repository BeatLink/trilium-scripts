# Notification Library

Shared library for sending desktop notifications from TriliumNext scripts. Clicking a notification navigates to the associated note.

The underlying `Notification` API only exists in the frontend, so this library ships a single **frontend** export (`lib`). Backend scripts that need to fire a notification should do the `runOnFrontend` hop themselves (see [`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/) for an example) rather than requiring a backend-callable wrapper.

## Usage (`lib` export)

For scripts that run in a frontend context (e.g. `"run": "frontendStartup"`, like [`notifications@beatlink`](../notifications@beatlink/)). Declare this addon as a dependency and clone the `lib` export as a child — `require()` it by its note title, `libNotification.js` (Trilium's bundler resolves `require()` by exact note title, so this library uses a fully-qualified title to avoid colliding with any other library's globals):

```js
const { sendNotification } = require("libNotification.js");
await sendNotification("Note Title", "Optional body text", noteId);
```

## API

### `sendNotification(title, body, noteId)`

| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `title`   | string | Notification title                       |
| `body`    | string | Notification body text (can be empty)    |
| `noteId`  | string | Note to activate when notification is clicked |
