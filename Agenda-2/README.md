# trilium-agenda
Agenda Script for Trilium


These scripts allow you to sort your to-dos into various notes depending on their due dates:

- Overdue
- Today
- This Week
- This Month
- This Year
- Future

## To Use
1. Create 6 notes to store tasks for the above categories.
2. Create a JS backend script and copy the contents of [updateAgenda.js](./updateAgenda.js)
   1. Set "#run=hourly" as a label for the updateAgenda.js script
   2. Set the note IDs for the 6 notes you created in the respective variables under "User Set Variables"
   3. Also set the dueTime label and dueDate label if they are different from the default
3. Create a JS frontend script and copy the contents of [setupButton.js](./setupButton.js). 
   1. Set "#run=frontendStartup" as a label for this script.
4. Reload the frontend or restart Trillium
5. For notes you want to track, give them a dueDate label of type date.
6.  Use the newly created launcher or wait an hour for the automatic update to update agenda.


## Changelog

### 2.0
- Added option to use number of days for intervals
- Migrated due date and time labels to variables
- Restructured and simplified main for loop
- Implemented branch prefix naming

### 1.0 
- Initial Release