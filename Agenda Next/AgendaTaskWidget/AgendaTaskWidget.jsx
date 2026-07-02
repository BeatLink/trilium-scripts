import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact";
import { searchForNotes, getActiveContextNote } from "trilium:api";

async function saveNoteLabel(noteId, label, value){
    api.runOnBackend(
        (noteId, label, value) => {
            api.getNote(noteId).setLabel(label, value)
        },
        [noteId, label, value]
    )
}

async function loadNoteLabel(noteId, label){
    console.log(noteId)
    console.log(label)
    if (noteId && label) {
        return api.runOnBackend(
            (noteId, label) => {
                return api.getNote(noteId).getLabelValue(label)
            },
            [noteId, label]
        )
    }
}

async function loadNoteJSON(noteId){
let profiles = []
    if (noteId) {
        return api.runOnBackend(
            (noteId) => {
                return JSON.parse(api.getNote(noteId).getContent())
            },
            [noteId]
        )
    }
}


function Section({id, label, children}){
    return (
        <div id={id}>
            <label>{label}</label>
            <div>{children}</div>
        </div>
    )
}


function Collapsible({id, className, label, children, onToggle, expanded}) {
    return (
        <details id={`${id}-details`} className={className} open={expanded} onToggle={onToggle}>
            <summary>{label}</summary>
            <div>{children}</div>
        </details>
    )
}

function MainSection({id, label, children, onToggle, expanded}){
    return (
        <Collapsible 
            id={id}
            label={label}
            expanded={expanded}
            onToggle={onToggle}
            className="mainSection"
        >
            {children}
        </Collapsible>
    )
}

function DateTimePicker({noteId, label, title}){
    
    const [dateTime, setDateTime] = useState(null)

    useEffect(() => {
        async function getDate() {
            const date = await loadNoteLabel(noteId, label)
            setDateTime(date)
        }
        getDate()
    }, [noteId, label])
    
    return (
        <Section
            id={`${label}-input`}
            label={title}
        >
            <input 
                id={`${label}-input`}
                type="datetime-local"
                placeholder="not set"
                className="form-control"
                onChange={event => {
                    const date = event.currentTarget.value
                    setDateTime(date)
                    saveNoteLabel(noteId, label, date)
                }}
                value={dateTime ? dateTime : ""}
            />
        </Section>
    )
}

function DurationPicker({noteId, label, title, durations}){

    const [duration, setDuration] = useState(null)
    
    useEffect(() => {
        async function getDuration() {
            const duration = await loadNoteLabel(noteId, label)
            setDuration(duration)
        }
        getDuration()
    }, [noteId, label])
    
    
    return (
        <Section id={`${label}-input`} label={title}>
            <FormDropdownList
                id={`${label}-input`}
                values={durations}
                currentValue={duration}
                onChange={value => {
                    setDuration(value)
                    saveNoteLabel(noteId, label, value)
                }}
                keyProperty="label" titleProperty="title"
                class="dropdown-component form-control"
            />
        </Section>
    )
}


function RecurrencePicker(){

    const [enabled, setEnabled] = useState(true)
    
    
    return (
        <Section id="recurrenceSection" label="Recurrence">
            <div>
                <FormCheckbox label="Task Repeats" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
            </div>
            <Section id="recurrenceIntervalSection" label="Interval" >
                <input
                    id="recurrenceIntervalNumberInput" type="number"
                    min="1" step="1" value="1"
                    class="form-control"
                />
                <FormDropdownList
                    id="recurrenceIntervalInput" 
                    values={[
                        { key: "MINUTELY", name: "Minute" },
                        { key: "HOURLY", name: "Hour" },
                        { key: "DAILY", name: "Day" },
                        { key: "WEEKLY", name: "Week" },
                        { key: "MONTHLY", name: "Month" },
                        { key: "YEARLY", name: "YEAR" }
                    ]}
                    currentValue={dropdownValue} onChange={setDropdownValue}
                    keyProperty="key" titleProperty="name"
                />
            </Section>
            <Section id="recurrenceWeekdaysSection" label="Weekdays">
                <FormCheckbox label="Sun" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Mon" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Tue" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Wed" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Thur" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Fri" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                <FormCheckbox label="Sat" currentValue={checkboxChecked} onChange={setCheckboxChecked} />            
            </Section>
            <Section id="recurrenceMonthdaySection" label="Day of Month">
                <FormDropdownList
                    id="recurrenceMonthOrdinalInput" 
                    values={[
                        { key: "1", name: "First" },
                        { key: "2", name: "Second" },
                        { key: "3", name: "Third" },
                        { key: "4", name: "Fourth" },
                        { key: "5", name: "Fifth" },
                        { key: "-1", name: "Last" }
                    ]}
                    currentValue={dropdownValue} onChange={setDropdownValue}
                    keyProperty="key" titleProperty="name"
                />
                <FormDropdownList
                    id="recurrenceMonthOrdinalInput" 
                    values={[
                        { key: "SU", name: "Sunday" },
                        { key: "MO", name: "Monday" },
                        { key: "TU", name: "Tuesday" },
                        { key: "WE", name: "Wednesday" },
                        { key: "TH", name: "Thursday" },
                        { key: "FR", name: "Friday" },
                        { key: "SA", name: "Saturday" }
                    ]}
                    currentValue={dropdownValue} onChange={setDropdownValue}
                    keyProperty="key" titleProperty="name"
                />
            </Section>
            <Section id="recurrenceStopSection" label="Stop Repeat">
                <FormDropdownList
                    id="recurrenceStopTypeInput" 
                    values={[
                        { key: "never", name: "Never" },
                        { key: "number", name: "After # of Repeats" },
                        { key: "date", name: "After a date" }
                    ]}
                    currentValue={dropdownValue} onChange={setDropdownValue}
                    keyProperty="key" titleProperty="name"
                />
                <input id="recurrenceStopNumberInput" type="number" min="1" step="1" value="1" class="form-control">
                <input id="recurrenceStopDateInput" type="datetime-local" class="form-control">
            </Section>
            <input id="recurrenceDataInput" type="hidden" name="recurrenceData" value=""/>
        </Section>
    )
}


function PriorityPicker(){
    return (
        <fieldset id="priorityFieldset">
            <legend>Priority</legend>
            <div>
                <div>
                    <div>
                        <select id="priorityInput" class="form-control">
                            <option value="">None</option>      
                            <option value="4-critical">Must Do</option>
                            <option value="3-high">Should Do</option>      
                            <option value="2-medium">Could Do</option>      
                            <option value="1-low">Want To Do</option>
                        </select>
                    </div>
                </div>
            </div>
        </fieldset>
            )
        }


        function ActionPicker() {
            return (
                <fieldset id="actionsFieldset">
            <legend>Actions</legend>
                <button id="markDoneButton" type="button" class="btn btn-primary">Mark Done</button>
                <button id="rescheduleButton" type="button" class="btn btn-primary" popoverTarget="reschedulePopover" style="anchor-name: --reschedule-anchor;">Reschedule</button>
                <aside id="reschedulePopover" popover style="position-anchor: --reschedule-anchor;">
                    <button id="rescheduleTodayButton" type="button" class="btn btn-primary">Today</button>
                    <button id="rescheduleTomorrowButton" type="button" class="btn btn-primary">Tomorrow</button>
                </aside>
        </fieldset>
            )
        }



function MainWidget(){
        let defaultDropdownOption = [{noteId: "none", name: "No Templates Found"}]
        const [existingTemplates, setExistingTemplates] = useState(defaultDropdownOption);
        const [dropdownValue, setDropdownValue] = useState("none");        
        const { note } = useActiveNoteContext();
        const noteId = useNoteProperty(note, "noteId");
        const [settings, setSettings] = useState({
            "startDatetimeLabel": "startDateTime",
            "startDateLabel": "startDate",
            "startTimeLabel": "startTime",
            "dueDatetimeLabel": "dueDateTime",
            "dueDateLabel": "endDate",
            "dueTimeLabel": "endTime",
            "durationLabel": "duration",
            "taskDurations": {
                "": "None",
                "PT5M": "5 Minutes",
                "PT10M": "10 Minutes",
                "PT15M": "15 Minutes"
            }
        });
    
        /*useEffect(() => {
            (async () => { 
                setExistingTemplates(
                    (await searchForNotes("#template #!noTemplatePicker orderBy note.title"))
                    .map(note => ({noteId: note.noteId, title: note.title}))
                    .concat({noteId: "none", title: "None"})
                )
                setDropdownValue(
                    (await getActiveContextNote())
                    .getRelationValue("template") ?? "none" 
                )
            })()
        }, [noteId]);*/

        useEffect(() => {
            async function loadSettings() {
                const settingNote = (await api.currentNote.getRelationTarget("settings")).noteId
                const settings = await loadNoteJSON(settingNote)
                setSettings(settings)
            }
            loadSettings()
        }, [noteId])
    
        if (!settings){
            return null
        }
        const saveTemplate = (template) => {
            api.runOnBackend((noteId, template) => {
                if (template != "none") {
                    api.getNote(noteId).setRelation("template", template)
                } else {
                    api.getNote(noteId).removeRelation("template")
                }
            }, [note.noteId, template]) 
            setDropdownValue(template)     
        }
        return (
            <RightPanelWidget id="x-agenda-task-widget" title="Task">
                <div id="x-agenda-task-widget">

                    <MainSection
                        id="dates"
                        label="Dates and Duration"
                        onToggle={e => {}}
                        expanded={true}
                    >
                        <DateTimePicker 
                            noteId={noteId}
                            label={settings.startDatetimeLabel}
                            title="Start Date"
                            onChange={value => {}}    
                        />
                        <DateTimePicker
                            noteId={noteId}
                            label={settings.dueDatetimeLabel}
                            title="Due Date"
                            onChange={value => {}}
                        />
                        <DurationPicker
                            noteId={noteId}
                            label={settings.durationLabel}
                            title="Duration"                        
                            durations={
                                Object.entries(settings.taskDurations)
                                .map(([label, title]) => ({
                                    "label": label,
                                    "title": title
                                }))
                            } 
                        />
                    </MainSection>

                    
                    <FormDropdownList
                            class="dropdown-component"
                            values={existingTemplates}
                            currentValue={dropdownValue}
                            onChange={value => { saveTemplate(value)}}
                            keyProperty="noteId" titleProperty="title"
                            class="form-control"
                        />
                </div>
            </RightPanelWidget>
        )        
    
}


export default defineWidget({
    parent: "right-pane",    
    position: 1,
    render: MainWidget
})
