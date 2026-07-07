import { defineLauncherWidget } from "trilium:preact"

// Loads the styles -----------------------------------------------------------------------------
const styles = `
    #mobileViewWidget {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100%;
    }

    body:not(.mobile-view) #mobileViewWidget {
        height: calc((var(--launcher-pane-vert-size) - (var(--launcher-pane-vert-button-margin) * 2)) + 12px) !important
    }

    body.mobile-view #mobileViewWidget {
        height: calc(((var(--launcher-pane-size) - (var(--launcher-pane-button-margin) * 2)) * 4) + 24px) !important
    }

    /* Hide irrelevant buttons --------------------------------------------*/
    body:not(.mobile-view) #mobileViewSetSidebar,
    body:not(.mobile-view) #mobileViewSetNote,
    body:not(.mobile-view) #mobileViewSetRightPane {
        display:none !important;
    }

    /* Sidebar Mode -------------------------------------------------------*/

    body.mobile-view[current-view="sidebar"] #right-pane,
    body.mobile-view[current-view="sidebar"] #rest-pane {
        display:none !important;
    }

    body.mobile-view[current-view="sidebar"] #left-pane {
        width:100% !important;
    }

    body.mobile-view[current-view="sidebar"] #left-pane .fancytree-node {
        height: fit-content;
        white-space: inherit;
        overflow: inhrerit;
    }

    /* Notes Mode ------------------------------------------------------------------*/

    body.mobile-view[current-view="note"] #right-pane,
    body.mobile-view[current-view="note"] #left-pane {
        display:none !important;
    }

    /* Right Pane Mode ------------------------------------------------------------------*/
    body.mobile-view[current-view="right-pane"] #center-pane,
    body.mobile-view[current-view="right-pane"] #left-pane {
        display:none !important;
    }

    body.mobile-view[current-view="right-pane"] #right-pane {
        width:100% !important;
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

function toggleMobileView() {
    document.body.classList.toggle("mobile-view")
}

function setSidebarView() {
    document.body.setAttribute("current-view", "sidebar")
}

function setNoteView() {
    document.body.setAttribute("current-view", "note")
}

function setRightPaneView() {
    document.body.setAttribute("current-view", "right-pane")
}

export default defineLauncherWidget({
    render: () => (
        <div id="mobileViewWidget">
            <button
                id="mobileViewToggle"
                title="Toggle Mobile View"
                className="launcher-button bx bx-mobile-alt"
                onClick={toggleMobileView}
            />
            <button
                id="mobileViewSetSidebar"
                title="Set Sidebar View"
                className="button-widget component launcher-button bx bx-chevron-left"
                onClick={setSidebarView}
            />
            <button
                id="mobileViewSetNote"
                title="Set Note View"
                className="button-widget component launcher-button bx bx-radio-circle"
                onClick={setNoteView}
            />
            <button
                id="mobileViewSetRightPane"
                title="Set Right Pane View"
                className="button-widget component launcher-button bx bx-chevron-right"
                onClick={setRightPaneView}
            />
        </div>
    )
})
