# Agenda

Agenda Script for Trilium

## Overview

These scripts allow you to organize your to-dos 

First agenda searches for notes matching specific search criteria. Any search criteria you can type into the search bar, you can load into a profile
Next, agenda can prefix and filter by their due date labels, number labels or text labels. 
Finally, agenda can set specific prefixes of the notes based on the value of their labels. 

## Profiles

Agenda operates using JSON profiles storing the search criteria, prefix type and prefix rules. You can therefore create profiles for example

- Work Tasks
- Home Tasks
- Repeating Tasks
- Projects
- Future Tasks

### Date Profile
The date profile allows you to sort your todos by due date into various intervals. The [project-date](./profiles/project-date.json) and [routines-date](./profiles/project-date.json) profiles organize tasks by the following criteria. 

- Overdue
- Today
- This Week
- This Month
- This Year
- Future


### Number Profile
The number profile allows you to prefix your todos with a numeric value. This is used by the [project-number](./profiles/project-number.json) profile. 


## JSON Structure


### Profile Name
All profiles start with a top level object giving the name of a profile. This allows you to store multiple profiles in a single json note though it is recommended to store each profile in its own note. This profile name must be unique.

### Search Criteria
This is the search terms that selects the notes that will be processed by this profile. Anything that you can type into Trilium's search bar can be used here to filter your notes. 

### ParentNoteID
All notes matching the search criteria will be added as a child of this note.

### Type
The profile type determines how tasks are prefixed and filtered. Valid values are 'date', 'number' and 'text'

### DateLabel (type = "date")
This is only used in 'date' profile type. Notes found by the searchCriteria are prefixed according to this label that should be on all matching notes. 

### UseNumberOfDays (type = "date")
If set to true, intervals such as weeks, months and years will be sorted by the number of days away from the present date. For example, if an interval is configured for endOfThisWeek, it will show tasks 7 days from now, rather than the next actual week

### EnableNoDueDate (type = "date")
If true, tasks with no due date set will still be shown under the parent ID. If false, such tasks would not be added at all.

### Intervals (type = "date")
This is a list of interval objects that tasks will be sorted under. Each interval can have a custom date range, prefix and filter to determine whether it is shown or not

### Interval Name (type = "date")
Every interval must have a unique name. Intervals with the same name will result in undefined behavior

### DateCriteria (type = "date")
The date criteria determines the date range that corresponds to this interval. The first element of the list corresponds to the day.js function that is called to check whether a task falls in this interval range. The remainder of the list consist of the arguments that are passed to the day.js function. 

The following placeholder variables will be replaced by the actual date values in the day.js function and are self explanatory.
* now
* startOfToday
* endOfToday
* endOfThisWeek
* endOfThisMonth
* endOfThisYear

### FormatString (type = "date")
This string is passed to the day.js format function to get the string format of the date that will be used as the prefix. To configure date formats see https://day.js.org/docs/en/display/format

### HideCriteria (type = "date")
If the parent note has a label and value matching this criteria, that specific interval will be hidden. This allows you to for example create a checkbox label on the parent note to show or hide tasks due next week. 

The first element of the list is the parent's name and the second is its value. 

### NumberLabel (type = "number")
This is only used for the 'number' profile type. The value of this label will be used to prefix your matching notes notes

### EnableNoNumber (type = "number")
If set to true, this will add matching tasks without a number label value to the parent note. If false, such tasks would be filtered out. 

### TextLabel (type = "text")
This is only used for the 'text' profile type. The value of this label will be used to prefix your notes according to the PrefixMap described below

### enableNoValue (type = "text")
If set to true, this will add matching tasks without a text label value to the parent note. If false, such tasks would be filtered out. 

### PrefixMap (type = "text")
This object converts the value of the text label to the prefix that should be used. That is, a task with a textLabel value of the key will be given a prefix of its associated value. 

## Quick Setup
1. Create a parent note to store the tasks processed by a specific profile.
2. Create a JS backend script and copy the contents of [updateAgenda.js](./updateAgenda.js)
   a. Set "#run=hourly" as a label for the updateAgenda.js script
3. Create a JS frontend script and copy the contents of [setupButton.js](./setupButton.js). 
   a. Set "#run=frontendStartup" as a label for this script.
4. Create a JSON note for the profile you wish to use
   a. You can copy and use a profile from the [profiles](./profiles/) folder of this repository. 
   b. Set the search criteria to the criteria matching your notes
   c. Set the parentNoteID to the id of the parent note you created in step 1. 
5. Create an '~agendaProfile' relationship on your updateAgenda.js note created in step 2 and set the value of this relationship to the JSON profile note you created in step 4.
4. Reload the frontend or restart Trillium
5.  Use the newly created launcher or wait an hour for the automatic update to update agenda.


## Changelog

### 3.0 
- Migration to Profile System
   Agenda now uses separate JSON profiles for different task types. 
- Addition of number and text type to the date type. 

### 2.0
- Added option to use number of days for intervals
- Migrated due date and time labels to variables
- Restructured and simplified main for loop
- Implemented branch prefix naming

### 1.0 
- Initial Release
