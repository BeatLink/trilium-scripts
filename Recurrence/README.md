# Recurrence

Script to update repeating to-dos

## To Use
1. Create a JS Frontend script and copy the contents of [updateRecurrence.js](./updateRecurrence.js). 
2. Create a JS frontend script and copy the contents of [setupButtons.js](./setupButtons.js).
   1. Set the scriptNoteID variables to the [updateRecurrence.js](./updateRecurrence.js) script note created in step 1. 
   2. Also set "#run=frontendStartup" as a label for the setupButton script
3.  Reload the frontend or restart trilium
4.  Your notes must have labels for due dates and when the task should repeat. Repeat format is based on the options here https://day.js.org/docs/en/manipulate/add. For example. A task that repeats every day would be written "1d" with the repeats label. A task that repeats every 3 months would be "3M"
5. Use the newly created launcher to update the recurrence of a given task


## Changelog

### 1.0 
- Initial Release