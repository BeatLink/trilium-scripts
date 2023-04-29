# trilium-agenda
Agenda Script for Trilium


These scripts allow you to sort your todos into various notes depending on their due dates:

- Overdue
- Today
- This Week
- This Month
- This Year
- Future

## To Use
1. Create 6 notes for the above categories.
2. Create a JS frontend script and copy the contents of ./update_agenda_button.js. Remember to set the "#run=frontendStartup" label that is commented on top.
3. Create a JS backend script and copy the contents of ./agenda_backend_script.js. Remember to set the "#run=hourly" label that is commented on top
4. Restart Trillium
5. For notes you want to track, give them a dueDate label of type date.
6. Use the newly created launcher or wait an hour for the automatic update to update agenda.
7. Profit
