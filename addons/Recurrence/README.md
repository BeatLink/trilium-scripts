# Recurrence

# trillium-recurrence
Scripts for repeating/recurring tasks

Tasks can be repeated every x days, weeks, months and years
Weekly tasks can also repeat on specific days
Monthly tasks can also be repeated on specific weekdays (eg first Sunday)


## To Use
1. Create a Note template for repeating tasks. This note must have a date time label for due dates to be updated. 
2. Create a JS Frontend script and copy the contents of [recurrencelib.js](recurrencelib.js)
3. Create a JS Frontend script and copy the contents of [recurrenceWidget.js](./recurrenceWidget.js)
   1. Set a label of #widget
   2. Clone the recurrencelib.js and paste it as a subnote of recurrenceWidget.js
   3. Create a note relation ~recurrenceTemplate= and point it to the template for recurring notes created in step 1
4. Create a JS Frontend script and copy the contents of [markDone.js](./markDone.js).
   1. Clone the recurrencelib.js and paste it as a subnote of markDone.js
   2. Create a label of #dueDateLabel= where dueDate is the datetime label created for the template on step 1
5. Create a JS frontend script and copy the contents of [setupButton.js](./setupButton.js).
   1. Set the label "#run=frontendStartup" as a label for setupButtons.js
   2. Create a note relation ~markDoneScript= pointing to the markDone.js note
6.  Reload the frontend or restart trilium
7. Use the newly created launcher to mark the task as done and update the recurrence of a given note


## Changelog

### 2.0 
- Switch to labels and relations instead of in code variables
- Refactor Code

### 1.0 
- Initial Release


