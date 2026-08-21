/*
 * libsponsorblock -- looks a YouTube video's skippable segments up on SponsorBlock.
 *
 * Frontend only: it is the consumer that owns a player and does the skipping,
 * so this library stops at the segment list. The lookup is the privacy-
 * preserving one -- the server is asked about every video id whose SHA-256
 * starts with the same four hex characters, and the answer is narrowed down
 * here, so it never learns which video is playing.
 */

const SPONSORBLOCK_API = "https://sponsor.ajay.app/api/skipSegments";

// The video id a YouTube URL points at, or null for any other URL.
const YOUTUBE_ID_RE = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;

function parseYouTubeVideoId(url) {
    const match = YOUTUBE_ID_RE.exec(url || "");
    return match ? match[1] : null;
}

// The SponsorBlock category each settings key turns on. A consumer's schema is
// expected to use these key names, so `sponsorBlockCategories` can read it.
const SPONSORBLOCK_CATEGORIES = {
    sponsor: "skipSponsor",
    selfpromo: "skipSelfPromo",
    interaction: "skipInteraction",
    intro: "skipIntro",
    outro: "skipOutro",
    preview: "skipPreview",
    music_offtopic: "skipMusicOfftopic",
    filler: "skipFiller"
};

// What a skipped segment is called when a skip is announced to the user.
const SPONSORBLOCK_LABELS = {
    sponsor: "Sponsor",
    selfpromo: "Self-promotion",
    interaction: "Interaction reminder",
    intro: "Intro",
    outro: "Outro",
    preview: "Preview",
    music_offtopic: "Non-music section",
    filler: "Filler"
};

function sponsorBlockCategories(settings) {
    return Object.keys(SPONSORBLOCK_CATEGORIES).filter((category) => settings?.[SPONSORBLOCK_CATEGORIES[category]]);
}

// The segments of `videoId` to skip, as {start, end, category, uuid} in the
// order SponsorBlock returned them.
async function fetchSponsorSegments(videoId, categories) {
    if (categories.length === 0) return [];

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId));
    const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const query = encodeURIComponent(JSON.stringify(categories));

    const response = await fetch(`${SPONSORBLOCK_API}/${hash.slice(0, 4)}?categories=${query}`);
    // 404 is the API's answer for a prefix nobody has submitted segments under.
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`SponsorBlock returned ${response.status}`);

    const entry = (await response.json()).find((item) => item.videoID === videoId);
    return (entry?.segments || [])
        // "skip" is the only action type handled: "mute" and "poi" need player
        // controls a consumer of this library is not assumed to have. A
        // downvoted segment is one the community judged wrong.
        .filter((segment) => segment.actionType === "skip" && segment.votes > -2)
        .map((segment) => ({ start: segment.segment[0], end: segment.segment[1], category: segment.category, uuid: segment.UUID }));
}

// The first segment `time` falls inside, ignoring any id in `skipped`. The end
// is held back slightly so a position already at a segment's end doesn't seek.
function segmentAt(segments, time, skipped) {
    return segments.find((segment) =>
        !skipped.has(segment.uuid) && time >= segment.start && time < segment.end - 0.2) || null;
}

module.exports = {
    YOUTUBE_ID_RE,
    parseYouTubeVideoId,
    SPONSORBLOCK_CATEGORIES,
    SPONSORBLOCK_LABELS,
    sponsorBlockCategories,
    fetchSponsorSegments,
    segmentAt
};
