# My Day

Script that lets you quickly add or remove tasks to a specific "My Day" note


## To Use
1. Create a new note to use as your My Day note; a note to store all the tasks and notes you wish to focus on for the present
2. Create a JS Frontend script and copy the contents of [addToMyDay.js](./addToMyDay.js). 
   1. Set the myDayNoteId variable to the note id of the note created in step 1
3. Create a JS Frontend script and copy the contents of [removeFromMyDay.js](./removeFromMyDay.js). 
   1. Set the myDayNoteId variable to the note id of the note created in step 1
4. Create a JS frontend script and copy the contents of [setupButtons.js](./setupButtons.js).
   1. Set the scriptNoteID variables to the [addToMyDay.js](./addToMyDay.js) and [removeFromMyDay.js](./removeFromMyDay.js) scripts notes created in steps 2 and 3 respectively. 
   2. Also set "#run=frontendStartup" as a label for the setupButton script
5.  Reload the frontend or restart trilium
6. Use the newly created launchers to add and remove notes from My Day


## Changelog

### 1.0 
- Initial Release