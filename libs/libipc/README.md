# IPC Library

Cross-plugin live event bus for TriliumNext frontend addons. One addon broadcasts an event; any other addon listening on the same channel reacts instantly, with no shared config, persistence, or note relations involved.

Every frontend widget runs inside the same browser window, so this library keeps a single shared `EventTarget` on `window` and hands every addon the same instance. It is fire-and-forget messaging: publishing notifies whoever is subscribed at that moment. There is no history, and events are not delivered to subscribers that join later. For shared *persistent* state, use TAM config notes instead.

## Usage (`lib` export)

For scripts that run in a frontend context. Declare this addon as a dependency and clone the `lib` export as a child, then `require()` it by its note title, `libIpc.js` (Trilium's bundler resolves `require()` by exact note title):

```js
const { publish, subscribe } = require("libIpc.js");

// Broadcasting addon
publish("agenda:taskCompleted", { taskNoteId });

// Listening addon
const unsubscribe = subscribe("agenda:taskCompleted", (payload) => {
    console.log("task done:", payload.taskNoteId);
});

// Later, on teardown:
unsubscribe();
```

Channel names are plain strings. Namespace them (`"agenda:taskCompleted"`) to avoid collisions between unrelated addons.

## API

### `publish(channel, payload)`

| Parameter | Type   | Description                                          |
|-----------|--------|------------------------------------------------------|
| `channel` | string | Channel name to broadcast on                         |
| `payload` | any    | Value delivered untouched to each subscriber         |

Synchronously invokes every current subscriber of `channel`. No return value.

### `subscribe(channel, handler)`

| Parameter | Type     | Description                                           |
|-----------|----------|-------------------------------------------------------|
| `channel` | string   | Channel name to listen on                             |
| `handler` | function | Called as `handler(payload, channel)` per event       |

Returns an unsubscribe function. Call it to stop listening (e.g. on widget teardown) to avoid leaks and duplicate handling across widget reloads.
