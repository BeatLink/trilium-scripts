# Setting Up an Addon Repository

[Back to README](./README.md)

## Repo Structure

Addon repositories must be structured in the following format:

* Repository Root
  * README.md
  * Template Picker
    * metadata.json
    * template-picker@beatlink
      * !!!meta.json
      * index.html
      * ....
  * .github
    * workflows
      * publish.py
      * publish.yml

## Required Files and Folders

### Top Level Folder

A repo can contain one or more addons. Each addon must be placed in its own top level folder. The name does not matter but can be set to the human friendly name of the addon. In the example above, Template Picker is the top level folder.

### Metadata File

All addons must have a metadata.json file in the top level folder, which provides metadata about the addon. It provides the unique ID, versioning information, links, descriptions, types and other information used for the Trillium Addon Manager to manage addons. The file must have the following fields

* id - This is in the format addon-name@author. For consistency it should be all lower case and contain no spaces. As it is used to identify the addon it must be unique.
* name - The human friendly name of the addon
* description - A brief description of the addon
* author - The name of the author, ideally the Github username.
* homepage - A link to the homepage of the addon, usually the Github folder.
* license - the copyright license for the addon
* latestVersion - the current version of the addon. This should be incremented when the addon changes to prompt TAM to update the addon. It should follow the semantic versioning standard.
* type - The type of the addon. Can be set to widget, script, theme, css, or template.

Here's an example below

```json
{
    "id": "template-picker@beatlink",
    "name": "Template Picker",
    "description": "A right pane dropdown widget that allows you to quickly set the template of the current note.",
    "author": "BeatLink",
    "homepage": "https://github.com/BeatLink/trilium-scripts/tree/main/Template%20Picker",
    "license": "GPL-3.0-or-later",
    "latestVersion": "1.0.0",
    "type": "widget"
}
```

### Addon Folder

This is the actual addon source code. To create the addon folder in the proper format:

1. Develop and make changes to your addon in Trilium.
2. Rename the main note of your addon to match the id string in your metadata.json
3. Export your addon and all its dependencies
4. In the export menu, select "This note and all of its descendants", then select "HTML in ZIP format"
5. Extract the exported zip to the respective location in the repository

This format was chosen as it allows for easy development and testing of addons using Trilium itself. It also allows easy installation by the plugin without need of a custom mechanism. By extracting the zip into the repo, it also allows git versioning to track changes and allows users to easily audit functionality without Trilium as well.

In the example above, this folder is represented by template-picker@beatlink

### .github/workflows/publish.py

This must be installed into the repo as shown. You can use the script from this repo. This script is responsible for finding all the plugins in the repo, consolidating all of the metadata information into a single json file and zipping up the found addons for release.

### .github/workflows/publish.yml

This must be installed into the repo as shown. You can use the file from this repo. This configures GitHub Actions to run the publishing script to generate the release assets upon every tag creation. Workflow artifacts are also created on every commit for testing and debugging purposes.

## Releases

All addons are built and released once a new tag is pushed to the main branch. It is recommended to separate main and development branches to prevent inadvertent updates of addons that are not yet ready.

Every release must contain:

- metadata.json - The consolidated metadata json file derived from all addon files in the repo
- addon@author.zip - The zipped addon files for each addon folder in the repo.

If you have installed the publish.py and publish.yml files as instructed above, these will be generated for you.
