/*
    Instructions: Paste the below into a new JS Frontend Script note. 
 */

// Loads the Styles -----------------------------------------------------------------------------------------------------------------------------

var styles = `

    #mobileViewWidget {
        height: 212px !important;
    }

    #mobileViewInner {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }
   
    #mobileViewToggle, 
    #mobileViewSetSidebar, 
    #mobileViewSetNote, 
    #mobileViewSetRightPane {
        font-size: 110%;
        padding: 10px 0;
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
var styleSheet = document.createElement("style")
styleSheet.textContent = styles
document.head.appendChild(styleSheet)

// Sets the viewport for mobile device width --------------------------------------------------------------------------------------------------
var viewport = document.createElement('meta');
viewport.name = 'viewport';
viewport.content = 'width=device-width, initial-scale=1.5'
document.head.appendChild(viewport);


// Creates the widget to control the mobile view -----------------------------------------------------------------------------------------------

const template = `
<div id="mobileViewWidget" class="launcher-button component">
    <div id="mobileViewInner">
        <span id="mobileViewToggle" title="Toggle Mobile View" class="bx bx-mobile-alt" ></span>
        <span id="mobileViewSetSidebar" title="Set Sidebar View" class="bx bx-chevron-left"></span>
        <span id="mobileViewSetNote" title="Set Note View" class="bx bx-radio-circle"></span>
        <span id="mobileViewSetRightPane" title="Set Right Pane View" class="bx bx-chevron-right"></span>
    </div>
</div>
`;

class MobileView extends api.BasicWidget {
    get position() {return 1;}
    get parentWidget() {return "left-pane"}

    doRender() {
        this.$widget = $(template);
        this.$widget.find("#mobileViewToggle").on("click", this.toggleMobileView)
        this.$widget.find("#mobileViewSetSidebar").on("click", this.setSidebarView)
        this.$widget.find("#mobileViewSetNote").on("click", this.setNoteView)
        this.$widget.find("#mobileViewSetRightPane").on("click", this.setRightPaneView)
        return this.$widget;
    }
    
    toggleMobileView() {
        $('body').toggleClass("mobile-view")
    }
    
    setSidebarView() {
        $('body').attr("current-view", "sidebar");
    }
    
    setNoteView() {
        $('body').attr("current-view", "note")
    }
    
    setRightPaneView() {
        $('body').attr("current-view", "right-pane")
    }
    
 }

module.exports = new MobileView();