import { useEffect, useRef, useState } from "trilium:preact"

// Load order matters: the iCalendar plugin reads the ICAL global at load
// time (not lazily), and FullCalendar core must exist before the plugin
// registers itself against it.
const SCRIPT_URLS = [
    "custom/libIcal.js",
    "custom/libFullCalendar.js",
    "custom/libFullCalendarICalendar.js"
]

let loadPromise = null

// Loads the vendored scripts exactly once per page, however many
// CalendarWidget instances end up mounting.
function loadFullCalendar() {
    if (!loadPromise) {
        loadPromise = SCRIPT_URLS.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
            const script = document.createElement("script")
            script.src = src
            script.onload = resolve
            script.onerror = () => reject(new Error(`Failed to load ${src}`))
            document.head.appendChild(script)
        })), Promise.resolve())
    }
    return loadPromise
}

// FullCalendar's iCalendar plugin only knows how to fetch a URL, so an
// already-in-hand ics string (e.g. libCalendar.js's generateCalendar output)
// is wrapped as a data: URL to reuse that same fetch-and-parse path rather
// than re-implementing ics parsing here.
function icsStringToDataUrl(icsString) {
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(icsString)
}

// Renders a day/week/month FullCalendar grid. Exactly one of `events`,
// `icsString`, or `eventsUrl` should be passed:
//   - events:    a plain array of FullCalendar-native event objects
//   - icsString: a raw ics string already in hand
//   - eventsUrl: any ics feed URL (including this Trilium instance's own)
export function CalendarWidget({
    events,
    icsString,
    eventsUrl,
    initialView = "timeGridWeek",
    slotDuration = "00:10:00",
    onEventClick
}) {
    const containerRef = useRef(null)
    const calendarRef = useRef(null)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        let cancelled = false
        loadFullCalendar().then(() => { if (!cancelled) setLoaded(true) })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!loaded || !containerRef.current) return

        const eventsConfig =
            events ? events :
            icsString ? { url: icsStringToDataUrl(icsString), format: "ics" } :
            eventsUrl ? { url: eventsUrl, format: "ics" } :
            []

        calendarRef.current = new window.FullCalendar.Calendar(containerRef.current, {
            headerToolbar: { center: "listDay,timeGridDay,timeGridWeek,dayGridMonth" },
            initialView,
            slotDuration,
            slotLabelInterval: "01:00:00",
            events: eventsConfig,
            eventClick: onEventClick ? (info) => onEventClick(info.event) : undefined
        })
        calendarRef.current.render()

        return () => {
            calendarRef.current?.destroy()
            calendarRef.current = null
        }
    }, [loaded, events, icsString, eventsUrl, initialView, slotDuration, onEventClick])

    return <div ref={containerRef} className="libcalendarwidget-container" />
}
