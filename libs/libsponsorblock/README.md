# SponsorBlock Library

Shared library for looking up the skippable segments of a YouTube video on
[SponsorBlock](https://sponsor.ajay.app). Frontend only — it uses `fetch` and `crypto.subtle`, and
it stops at the segment list: whoever owns the player does the skipping.

The lookup is the privacy-preserving one. SponsorBlock is asked about every video id whose SHA-256
starts with the same four hex characters, and the answer is narrowed to the video actually asked
about here, so the server never learns what is playing.

Include it as a child of whichever note calls `require()`, under the title `libSponsorBlock.js`.

```js
const sb = require("libSponsorBlock.js");

const segments = await sb.fetchSponsorSegments("dQw4w9WgXcQ", sb.sponsorBlockCategories(settings));
const segment = sb.segmentAt(segments, player.currentTime, skipped);
if (segment) player.currentTime = segment.end;
```

## API

### `fetchSponsorSegments(videoId, categories)`

Resolves to `[{ start, end, category, uuid }]` — only `actionType: "skip"` segments that are not
downvoted, in the order SponsorBlock returned them. An empty `categories` list, an unknown video,
or a video nobody has submitted segments for all give `[]`. Throws on a failed request.

### `sponsorBlockCategories(settings)`

The category names enabled in a settings object, read from the keys in `SPONSORBLOCK_CATEGORIES`
(`skipSponsor`, `skipSelfPromo`, `skipInteraction`, `skipIntro`, `skipOutro`, `skipPreview`,
`skipMusicOfftopic`, `skipFiller`) — so a consumer's schema should use those names.

### `segmentAt(segments, time, skipped)`

The first segment `time` falls inside whose `uuid` is not in the `skipped` set, else `null`.

### `parseYouTubeVideoId(url)` / `YOUTUBE_ID_RE`

The video id in a `watch`, `youtu.be`, `shorts`, `embed` or `live` URL, else `null`. The regex is
exported for consumers that need to repeat the test somewhere the module can't be loaded (e.g.
inside a script injected into another page).

### `SPONSORBLOCK_LABELS`

Display name per category, for announcing a skip.
