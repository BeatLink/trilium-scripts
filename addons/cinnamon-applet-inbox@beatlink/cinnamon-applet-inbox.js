const { loadSettings } = libsettings

let schemaNoteId = api.currentNote.getRelationValue("schemaNote")
let settingsNoteId = api.currentNote.getRelationValue("settingsNote")
let configNoteId = api.getNote(settingsNoteId).getRelationValue("AddonData:config")

let settings = loadSettings(schemaNoteId, configNoteId)
let apiKey = settings.apiKey
let inboxNoteId = settings.inboxNoteId

// Get the first line of a note, HTML-stripped
function getNoteFirstLine(noteId) {
    let note = api.getNote(noteId)
    let content = note.getContent()
    let first_line = content.slice(0, content.indexOf("</p>"))
    return first_line.replace("<p>", "").replace("&nbsp;", "").replace(/<[^>]+>/g, '')
}

// Finds timespan tokens (e.g. "30m", "2h") in a string; returns the total
// milliseconds and the string with those tokens stripped out
function parseTimeSpan(str) {
    const regex = /(\d+)\s*(ms|s|m|h|d)/g
    let match
    let totalMs = 0
    while ((match = regex.exec(str)) !== null) {
        const value = Number(match[1])
        const unit = match[2]
        switch (unit) {
            case 'ms': totalMs += value; break
            case 's': totalMs += value * 1000; break
            case 'm': totalMs += value * 1000 * 60; break
            case 'h': totalMs += value * 1000 * 60 * 60; break
            case 'd': totalMs += value * 1000 * 60 * 60 * 24; break
        }
    }
    const formattedText = str.replace(regex, "").trim().replace(/\s{2,}/g, " ")
    return { time_span: totalMs, formattedText }
}

// Converts milliseconds to a "hh:mm:ss" string
function millisecondsToString(ms) {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {
    if (api.req.body.action == "get_inbox") {
        let text = getNoteFirstLine(inboxNoteId)
        let saved_text = api.currentNote.getLabelValue("text")
        let { time_span, formattedText } = parseTimeSpan(text)
        let start_time = api.currentNote.getLabelValue("start_time")
        let response = {
            text: formattedText,
            onclick_data: inboxNoteId,
            reminder_enabled: false,
            reminder_time: 500,
            reminder_delay: 1,
            reminder_color: "#00ACFF",
            prefix_string: " ",
            suffix_string: " "
        }

        if (!text) {
            // Empty inbox: disable the reminder and clear any saved timer state
            response.reminder_enabled = false
            api.currentNote.removeLabel("text")
            api.currentNote.removeLabel("start_time")
            response.reminder_color = ""
        } else if (time_span == 0) {
            // Text present but no timespan token found: flash solid blue to
            // prompt adding one (e.g. "Take out trash 30m")
            response.reminder_enabled = true
            response.reminder_time = 1
            response.reminder_delay = 0
            response.reminder_color = "#00ACFF"
        } else {
            // Timespan present: (re)arm the timer on a new or changed inbox
            // note, and notify once when it (re)starts
            if (!start_time || !saved_text || text != saved_text) {
                start_time = new Date().toISOString()
                api.currentNote.setLabel("start_time", start_time)
                api.currentNote.setLabel("text", text)
                // Notification must run on the frontend (Notification API isn't
                // available on the backend) — self-contained closure, same
                // convention as every other runOnBackend/runOnFrontend call in
                // this repo, so it isn't relying on a cloned library global
                // being available in a different execution context.
                api.runOnFrontend((title, body, noteId) => {
                    let notification = new window.Notification(title, { body, tag: "cinnamon-applet-inbox" })
                    notification.onclick = (event) => {
                        event.preventDefault()
                        api.activateNote(noteId)
                    }
                }, [formattedText, "", inboxNoteId])
            }

            let elapsed_time = (new Date()) - (new Date(start_time))
            let remaining_time = time_span - elapsed_time
            if (remaining_time <= 0) {
                // Timer expired: flash solid red
                response.reminder_enabled = true
                response.reminder_time = 1
                response.reminder_delay = 0
                response.reminder_color = "#FF0000"
            } else {
                // Timer running: show remaining time
                response.reminder_enabled = true
                response.reminder_time = 150
                response.reminder_delay = 1
                response.suffix_string = ` [${millisecondsToString(remaining_time)}] `
            }
        }
        api.res.status(200).json(response)
    } else if (api.req.body.action == "open_inbox") {
        api.runOnFrontend((noteID) => {
            api.activateNote(noteID)
        }, [api.req.body.onclick_data])
        api.res.status(200).json({"noteActivated": "true"})
    }
} else {
    api.res.send(400)
}
