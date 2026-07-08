const overview = require("libAgendaOverview.js")

// Focuses the existing "Agenda Now" Electron window if one is already open,
// or creates and positions a new one showing nowNoteId. Electron-only — has
// no effect (and shouldn't be called) outside the desktop app.
async function launchAgendaNow(nowNoteId, windowConfig) {
    await api.runOnBackend((nowNoteId, windowConfig) => {
        const { BrowserWindow, screen } = require('electron');
        const remoteMain = require('@electron/remote/main');

        const allWindows = BrowserWindow.getAllWindows()
        let nowWindow = allWindows.find(win => win.AgendaNow === 'AgendaNow');
        let getMainWindow = () => BrowserWindow.getAllWindows()?.[0];
        const url = URL.parse(getMainWindow().webContents.getURL()).origin
        const newURL = `${url}/#note/${nowNoteId}`

        if (nowWindow) {
            if (nowWindow.isMinimized()) {
                nowWindow.restore();
            }
            nowWindow.show();
            nowWindow.focus();
        } else {
            // Initialize the new window
            nowWindow = new BrowserWindow({
                alwaysOnTop: windowConfig.alwaysOnTop,
                autoHideMenuBar: windowConfig.hideMenubar,
                frame: !windowConfig.hideTitlebar,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    additionalArguments: [`agendaNowData=${nowNoteId}`]
                }
            });
            remoteMain.enable(nowWindow.webContents);
            nowWindow.AgendaNow = "AgendaNow"
            nowWindow.on('closed', () => {
                nowWindow = null;
                const mainWindow = getMainWindow()
                if (mainWindow){
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                    }
                    mainWindow.show();
                    mainWindow.focus();
                }
            })
        }

        // Load Now Note
        nowWindow.loadURL(newURL);

        // Set Window Position
        const workArea = screen.getPrimaryDisplay().workArea; // { x, y, width, height }
        const x = workArea.x + workArea.width - windowConfig.width - windowConfig.windowGap;
        const y = workArea.y + workArea.height - windowConfig.height - windowConfig.windowGap;
        nowWindow.setBounds({
            x,
            y,
            width: windowConfig.width,
            height: windowConfig.height
        });

    }, [nowNoteId, windowConfig])
}

// Appends a reference to noteId onto the "Now" note's content (optionally as
// a checkbox to-do), unless it's already there
async function addTaskToAgendaNow(nowNoteId, noteId, todoEnabled) {
    api.runOnBackend((nowNoteId, currentNoteId, todoEnabled) => {
        const currentNote = api.getNote(currentNoteId)
        let currentNoteString = `<a class="reference-link" href="#root/${currentNoteId}">${currentNote.title}</a>`
        const nowNote = api.getNote(nowNoteId)
        const nowNoteContent = nowNote.getContent()

        if (!nowNoteContent.includes(currentNoteString)){
            if (todoEnabled) {
                currentNoteString = `<ul class="todo-list"><li data-list-item-id="${api.randomString(32)}"><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">${currentNoteString}</span></label></li></ul>`
            } else {
                currentNoteString = `<p>${currentNoteString}</p>`
            }
            const newNoteContent = nowNoteContent.concat(currentNoteString)
            nowNote.setContent(newNoteContent)
            nowNote.save()
        }
    }, [nowNoteId, noteId, todoEnabled])
}

// Adds every task starting exactly now (per the overview's task list) onto
// the "Now" note as a to-do
async function addDueTasksToAgendaNow(profileContext, constants, nowNoteId){
    const taskList = await overview.getTaskList(profileContext)
    for (const taskId of taskList){
        const task = await api.getNote(taskId)
        const startDate = task.getLabelValue(constants.START_DATETIME_LABEL)
        if (startDate) {
            if (api.dayjs().isSame(startDate, "minute")) {
                await addTaskToAgendaNow(nowNoteId, taskId, true)
            }
        }
    }
}

async function setupLauncherWidget(widgetNoteId) {
    await api.runOnBackend(
        (widgetNoteId) => {
            api.createOrUpdateLauncher({
                id: "agendaNowLauncher",
                title: "Agenda Launcher Widget",
                type: "customWidget",
                isVisible: true,
                widgetNoteId: widgetNoteId
            });
        },
        [widgetNoteId]
    );
}


module.exports = {
    launchAgendaNow,
    addTaskToAgendaNow,
    addDueTasksToAgendaNow,
    setupLauncherWidget
}
