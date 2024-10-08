# Starred

Script that lets you quickly add or remove tasks to a specific "Starred" note


## To Use
1. Create a new note to use as your Starred note; a note to store all the tasks and notes you wish to focus on for the present
2. Create a JS Frontend script and copy the contents of [./toggleStarred.js](./toggleStarred.js). 
   1. Create a starredNote relation pointing to the note id of the note created in step 1
3. Create a JS frontend script and copy the contents of [setupButtons.js](./setupButtons.js).
   1. Create a ~toggleStarredScript relation pointing to the [toggleStarred.js](./toggleStarred.js) script note created in steps 2. 
   2. Also set "#run=frontendStartup" as a label for the setupButton script
4.  Reload the frontend or restart trilium
5. Use the newly created launchers to add and remove notes from Starred


## Changelog

### 2.0
- Rename My Day to Starred
- Replace in code variables with note relations
- Combined both scripts into a single script

### 1.0 
- Initial Release