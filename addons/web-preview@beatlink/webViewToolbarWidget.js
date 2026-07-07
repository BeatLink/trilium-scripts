// === Trilium Code note ===
// Title: webViewToolbarWidget.js
// Type: Code -> JS Frontend
// Add the label #widget to this note, then Ctrl+Shift+R to reload frontend.
//
// Shows a small toolbar (Back / Forward / Save to Inbox / Open in Browser)
// above any note of type "Web View". Drives the *actual* Electron <webview>
// element that Trilium's built-in Web View note type already renders —
// no separate popup window needed.

const TPL = `
<div class="web-view-toolbar" style="
    display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-bottom: 1px solid #ddd; contain: none;">
  <button class="wv-back" title="Back" style="border:none;border-radius:6px;padding:6px 10px;cursor:pointer;background:#eee;">◀</button>
  <button class="wv-forward" title="Forward" style="border:none;border-radius:6px;padding:6px 10px;cursor:pointer;background:#eee;">▶</button>
  <div class="wv-url" style="flex:1;min-width:0;font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
  <button class="wv-save" style="border:none;border-radius:6px;padding:6px 12px;cursor:pointer;background:#4b6fff;color:white;font-size:12px;">Save to Inbox</button>
  <button class="wv-external" style="border:none;border-radius:6px;padding:6px 12px;cursor:pointer;background:#eee;font-size:12px;">Open in Browser</button>
</div>`;

class WebViewToolbarWidget extends api.NoteContextAwareWidget {
    get parentWidget() {
        return "center-pane";
    }

    get position() {
        return 90; // above the note content area
    }

    isEnabled() {
        return super.isEnabled() && this.note?.type === "webView";
    }

    doRender() {
        this.$widget = $(TPL);

        this.$back = this.$widget.find(".wv-back");
        this.$forward = this.$widget.find(".wv-forward");
        this.$url = this.$widget.find(".wv-url");
        this.$save = this.$widget.find(".wv-save");
        this.$external = this.$widget.find(".wv-external");

        this.$back.on("click", () => {
            const wv = this.getWebviewEl();
            if (wv?.canGoBack()) wv.goBack();
        });

        this.$forward.on("click", () => {
            const wv = this.getWebviewEl();
            if (wv?.canGoForward()) wv.goForward();
        });

        this.$save.on("click", async () => {
            const wv = this.getWebviewEl();
            if (!wv) return;

            const url = wv.getURL();
            const title = wv.getTitle() || url;

            this.$save.prop("disabled", true).text("Saving…");
            try {
                const lib = require("libWebPreview.js");
                await lib.saveUrlToInbox(url, title);
                this.$save.text("Saved ✓");
            } catch (err) {
                this.$save.text("Save failed");
                console.error(err);
            } finally {
                setTimeout(() => {
                    this.$save.prop("disabled", false).text("Save to Inbox");
                }, 1500);
            }
        });

        this.$external.on("click", async () => {
            const wv = this.getWebviewEl();
            if (!wv) return;
            const lib = require("libWebPreview.js");
            await lib.openExternal(wv.getURL());
        });

        return this.$widget;
    }

    // Locates the Electron <webview> element Trilium renders for this note.
    // Selector specifics can vary across Trilium versions — adjust if this
    // doesn't find it in yours (see README "Known caveats").
    getWebviewEl() {
        let el = document.querySelector(
            `[data-note-id="${this.noteId}"] webview, .note-detail-web-view[data-note-id="${this.noteId}"] webview`
        );
        if (!el) {
            // Fallback: grab the first visible webview on the page.
            const candidates = Array.from(document.querySelectorAll("webview"));
            el = candidates.find((w) => w.offsetParent !== null) || candidates[0];
        }
        return el || null;
    }

    bindWebviewEvents() {
        const wv = this.getWebviewEl();
        if (!wv || wv.__wvToolbarBound) return;
        wv.__wvToolbarBound = true;

        const refresh = () => {
            this.$back.prop("disabled", !wv.canGoBack());
            this.$forward.prop("disabled", !wv.canGoForward());
            this.$url.text(wv.getURL());
        };

        wv.addEventListener("did-navigate", refresh);
        wv.addEventListener("did-navigate-in-page", refresh);
        wv.addEventListener("dom-ready", refresh);
        refresh();
    }

    async refreshWithNote(note) {
        // Webview element may not exist yet the instant the note switches in;
        // a short delay lets Trilium finish rendering it.
        setTimeout(() => this.bindWebviewEvents(), 150);
    }
}

module.exports = new WebViewToolbarWidget();
