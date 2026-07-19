# Template Picker

A right-pane widget that lets you assign or change the template of the currently active note.

## How it works

The widget appears in the right pane and shows a dropdown of your configured templates. Selecting a template sets a `~template` relation on the current note. Selecting "None" removes the relation.

Which templates appear, and in what order, is configured in the addon's settings note rather than derived from the tree on every note switch.

## Configuring templates

Open the addon's settings note and use the **Templates** registry:

- **Scan for templates** searches the tree for every `#template` note and adds a row for any not already listed, enabled, at the end of the order. Existing rows keep their name, enabled state, and order, so scanning again after adding a template is safe.
- **Enabled** controls whether a template appears in the dropdown.
- **Order** sets its position in the dropdown, ascending. Use the row move controls or edit the number directly.
- **Name** is the text shown in the dropdown. It defaults to the template note's title and editing it does not rename the note.

Click **Save** to persist your changes.

Rows whose template note has been deleted are skipped automatically. If the active note's `~template` points at a template that is disabled or not listed, the dropdown shows "⚠ Not listed" rather than reporting the note as having no template.

Before the first scan the registry is empty, and the picker falls back to showing every `#template` note sorted by title.

## Upgrading from 1.0.x

The `#noTemplatePicker` label is no longer read. To hide a template, scan once and untick its **Enabled** box.
