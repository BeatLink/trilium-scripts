# MultiSort Library

Shared library for sorting TriliumNext notes by multiple attributes. Used as a dependency by addons that need multi-criteria sorting.

## Usage

Install this addon as a dependency. TAM clones the `libMultisort.js` note as a child of any script
that declares it; `require()` it by that title (the note title is what Trilium's bundler resolves
`require()` calls against, so keeping it a distinctive, fully-qualified name avoids collisions with
other libraries):

```js
const { sortChildNotes } = require("libMultisort.js");
const sorted = sortChildNotes(sortString, childNotes);
```

## Sort string format

Attributes are separated by `;`. Each attribute can have colon-separated criteria flags.

```
priority:desc;area;startDateTime;title:caseInsensitive
```

| Flag              | Effect                          |
|-------------------|---------------------------------|
| `desc`            | Sort descending                 |
| `caseInsensitive` | Ignore case when comparing      |

## Built-in attributes

`noteId`, `title`, `dateCreated`, `dateModified` are read directly from the note object. All other attribute names are resolved via `note.getLabelValue()`.

## API

### `sortChildNotes(sortString, childNotes)`

Returns a new sorted array of notes. Does not mutate the input.

### `parseSortCriteria(sortString)`

Returns the parsed criteria array — useful for debugging or building custom sort logic.
