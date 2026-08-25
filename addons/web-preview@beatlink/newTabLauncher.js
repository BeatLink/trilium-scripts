// === Trilium Code note ===
// Title: newTabLauncher.js
// Type: Code -> JS Frontend
// Run by the New Tab launchbar button, not by an attribute.
// Must not be a child of a #run=frontendStartup note: children are bundled with it and run at startup.

// ---------------------------------------------------------------------------
// Toggles the New Tab box over the note being read. The box is a widget in every
// split, so the button only has to announce itself — the active split's widget
// takes it from there, and knows on its own which note to file a new tab under.
// ---------------------------------------------------------------------------
window.dispatchEvent(new CustomEvent("web-preview:new-tab"));
