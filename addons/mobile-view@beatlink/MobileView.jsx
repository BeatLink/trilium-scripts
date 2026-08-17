import { ActionButton, defineLauncherWidget, useState } from "trilium:preact"

// Loads the styles -----------------------------------------------------------------------------
const styles = `
    /* The launcher pane resolves --launcher-pane-size / -button-margin / -button-gap per
       orientation on #launcher-pane.vertical|.horizontal, so the inherited values are used rather
       than the vertical ones, which are wrong in a horizontal launcher pane. The widget sizes to
       its buttons; flex-shrink is only pinned so a crowded pane can't squeeze it. */
    #mobileViewWidget {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100%;
    }

    #launcher-container > *:has(> #mobileViewWidget) {
        flex-shrink: 0;
    }

    body.layout-horizontal #mobileViewWidget {
        flex-direction: row;
        width: auto;
        height: 100%;
    }

    /* No launcher button in Trilium uses ActionButton's active state, so it has no styling of its
       own. Reuse the pane's hover tokens (shell.css) so the selected view reads as pressed. */
    #launcher-pane #mobileViewWidget .launcher-button.active {
        background: var(--launcher-pane-button-hover-background) !important;
        color: var(--launcher-pane-button-hover-color);
        box-shadow: var(--launcher-pane-button-hover-shadow);
    }

    /* Sidebar Mode -------------------------------------------------------*/

    /* #rest-pane holds both the center pane and the right pane, so hiding it covers both. */
    body.mobile-view[current-view="sidebar"] #rest-pane {
        display: none !important;
    }

    body.mobile-view[current-view="sidebar"] #left-pane {
        width: 100% !important;
    }

    /* Let long titles wrap instead of being clipped to one 38px row. */
    body.mobile-view[current-view="sidebar"] #left-pane .fancytree-node {
        height: auto;
        min-height: 38px;
        overflow: visible;
        white-space: normal;
    }

    body.mobile-view[current-view="sidebar"] #left-pane .fancytree-title {
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: anywhere;
    }

    /* Notes Mode ------------------------------------------------------------------*/

    /* #right-pane sits inside #right-pane-host under the new layout and directly in
       #vertical-main-container otherwise, so both are targeted. */
    body.mobile-view[current-view="note"] #left-pane,
    body.mobile-view[current-view="note"] #right-pane-host,
    body.mobile-view[current-view="note"] #right-pane,
    body.mobile-view[current-view="note"] .right-pane-peek-button {
        display: none !important;
    }

    /* Right Pane Mode ------------------------------------------------------------------*/

    body.mobile-view[current-view="right-pane"] #center-pane,
    body.mobile-view[current-view="right-pane"] #left-pane,
    body.mobile-view[current-view="right-pane"] .right-pane-peek-button,
    body.mobile-view[current-view="right-pane"] .right-pane-peek-spacer {
        display: none !important;
    }

    /* Reclaim the gutter the new layout reserves for the peek button. */
    body.mobile-view[current-view="right-pane"] #vertical-main-container {
        padding-inline-end: 0 !important;
    }

    /* Split sets inline widths on the host's children; !important overrides them. A peeking pane
       is an absolute overlay, so it is put back in flow before being filled out. */
    body.mobile-view[current-view="right-pane"] #right-pane-host,
    body.mobile-view[current-view="right-pane"] #right-pane {
        position: static !important;
        flex: 1 1 auto !important;
        width: 100% !important;
    }
`
const styleSheet = document.createElement("style")
styleSheet.textContent = styles
document.head.appendChild(styleSheet)

// Sets the viewport for mobile device width -----------------------------------------------------
const viewport = document.createElement("meta")
viewport.name = "viewport"
viewport.content = "width=device-width, initial-scale=1.5"
document.head.appendChild(viewport)

// Matches getTitlePosition() in Trilium's launch bar: tooltips sit below a horizontal pane and
// beside a vertical one.
const titlePosition = document.body.classList.contains("layout-horizontal") ? "bottom" : "right"

const VIEWS = [
    { id: "sidebar", icon: "bx bx-chevron-left", text: "Set Sidebar View" },
    { id: "note", icon: "bx bx-radio-circle", text: "Set Note View" },
    { id: "right-pane", icon: "bx bx-chevron-right", text: "Set Right Pane View" }
]

function MobileView() {
    const [enabled, setEnabled] = useState(false)
    const [view, setView] = useState("note")

    function selectView(viewId) {
        setView(viewId)
        document.body.setAttribute("current-view", viewId)
    }

    function toggle() {
        const next = !enabled
        setEnabled(next)
        document.body.classList.toggle("mobile-view", next)
        if (next) {
            document.body.setAttribute("current-view", view)
        }
    }

    return (
        <div id="mobileViewWidget">
            <ActionButton
                className="button-widget launcher-button"
                noIconActionClass
                icon="bx bx-mobile-alt"
                text="Toggle Mobile View"
                titlePosition={titlePosition}
                active={enabled}
                onClick={toggle}
            />
            {enabled && VIEWS.map(({ id, icon, text }) => (
                <ActionButton
                    key={id}
                    className="button-widget launcher-button"
                    noIconActionClass
                    icon={icon}
                    text={text}
                    titlePosition={titlePosition}
                    active={view === id}
                    onClick={() => selectView(id)}
                />
            ))}
        </div>
    )
}

export default defineLauncherWidget({
    render: () => <MobileView />
})
