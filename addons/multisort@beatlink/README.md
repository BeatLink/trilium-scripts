# MultiSort

Automatically sorts the children of any note labelled `#multiSorted` by multiple attributes and criteria.

## Setup

Add `#multiSorted="<sortCriteria>"` to any note whose children you want sorted. The script runs at frontend startup and applies the sort order.

## Sort string format

Attributes separated by `;`. Each attribute can have colon-separated flags.

```
#multiSorted="priority:desc;area;startDateTime;title:caseInsensitive"
```

The example sorts children first by `priority` descending, then by `area`, then by `startDateTime`, then by `title` case-insensitively.

| Flag              | Effect                     |
|-------------------|----------------------------|
| `desc`            | Sort descending            |
| `caseInsensitive` | Ignore case when comparing |

## Built-in attributes

`noteId`, `title`, `dateCreated`, `dateModified` are read from the note directly. All other names resolve via `getLabelValue()`.

## How it works

1. Searches for all notes with `#multiSorted`
2. Sorts each note's children using [MultiSort Library](../libmultisort@beatlink/)
3. Saves each child's sort position as `#multiSortedValue_{parentId}`
4. Sets `#sorted=multiSortedValue_{parentId}` on the parent so TriliumNext applies the order
