# Salvaged config

Config and one feature idea recovered from a pre-TAM agenda overview install, kept because nothing
in the addon generates them any more. Paste a block into the matching registry on the Agenda
Settings page and edit the names to suit; none of this is loaded automatically.

## Multi-axis sorts

Since 5.0.0 each installed picker generates exactly one sort, `<Name> -> Start Date`. Orderings that
combine two axes are no longer produced by anything. These six were in use before that change, in
[libmultisort](../../../libs/libmultisort/README.md) syntax, which is what a sort criterion's stored
value still is:

```json
{
    "typePriorityStartDate": {
        "name": "Type -> Priority -> Start Date",
        "sort": "type;priority:desc;startDateTime"
    },
    "typeStartDate": {
        "name": "Type -> Start Date",
        "sort": "type;startDateTime"
    },
    "priorityTypeStartDate": {
        "name": "Priority -> Type -> Start Date",
        "sort": "priority:desc;type;startDateTime"
    },
    "priorityStartDate": {
        "name": "Priority -> Start Date",
        "sort": "priority:desc;startDateTime"
    },
    "area": {
        "name": "Area -> Start Date",
        "sort": "area;startDateTime"
    },
    "startDate": {
        "name": "Start Date",
        "sort": "startDateTime"
    }
}
```

Two caveats before reusing them.

The three entries sorting by `#type` are dead as written. Item type became a `~template` relation, so
nothing has written that label for several versions. Drop the `type;` segment or point the criterion
at By Template instead.

`priority:desc` was correct when the priority list ran low to high. The picker now lists
`4-critical` first, so ascending already means most important first and the `:desc` flag reverses it.

## Curated template searches

The generated template searches match on a template's note id and already exclude a note filed
directly under another note of the same template. These older hand-written rules did the same by
title, and are here for the naming scheme they record (`1. High Priority` through `4. Future`,
predating the current template titles) rather than because the query logic is missing:

```json
{
    "highPriority": {
        "name": "1. High Priority",
        "search": "~template.title='1. High Priority' AND not(note.parents.relations.template.title='1. High Priority')",
        "enabled": true
    },
    "routine": {
        "name": "2. Routines",
        "search": "~template.title='2. Routine' AND not(note.parents.relations.template.title='2. Routine')",
        "enabled": true
    },
    "tasks": {
        "name": "3. Tasks",
        "search": "~template.title='3. Task' AND not(note.parents.relations.template.title='3. Task')",
        "enabled": true
    },
    "future": {
        "name": "4. Future",
        "search": "~template.title='4. Future' AND not(note.parents.relations.template.title='4. Future')",
        "enabled": true
    }
}
```

## Unbuilt: Start All Tasks Today

A prototype of this widget carried an Actions section with a single button, "Start All Tasks Today"
(`bx bx-rocket`), calling a `rescheduleAllTasks()` that set every task in the current overview list
to start now. Nothing in the repo implements it today.

`agenda-task@beatlink` reschedules one note, or a tree multi-selection, through its own Actions
section. A bulk action over a whole overview list would be the missing piece: it already has the
list, and `rescheduleByDays(noteId, constants, 0)` in that addon's `libAgendaTask.js` is the per-note
half.
