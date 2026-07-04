# Notification Library

Shared library for sending desktop notifications from TriliumNext scripts. Clicking a notification navigates to the associated note.

## Usage

Install this addon as a dependency. TAM will clone the `libnotification` note as a child of any script note that declares it as a dependency, making it available as a bundle global.

In the consuming script:

```js
const { sendNotification } = libnotification;
await sendNotification("Note Title", "Optional body text", noteId);
```

## API

### `sendNotification(title, body, noteId)`

| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `title`   | string | Notification title                       |
| `body`    | string | Notification body text (can be empty)    |
| `noteId`  | string | Note to activate when notification is clicked |
