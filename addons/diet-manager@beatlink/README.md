# Diet Manager

A food and recipe database with a daily nutrition diary and a grocery list, built to replace
Cronometer. All data — categories, foods, recipes, the diary, and the grocery list — lives in one
persisted JSON note, so it's a single note you can back up, inspect, or migrate.

## Setup

1. Install the addon and enable it.
2. Open its launcher note (`diet-manager@beatlink`) to use the widget.
3. Optionally, open the addon's settings screen to set daily nutrient targets and a USDA
   FoodData Central API key for food lookup (Open Food Facts lookup needs no key and works out of
   the box).

## Foods

The **Foods** tab is your ingredient database. Each food has a name, an optional brand, a serving
size/unit (e.g. "100 g" or "1 cup"), and nutrition facts *per that serving*: calories, protein, carbs, fat, fiber,
sugar, saturated fat, sodium, and cholesterol.

**Add Food** opens a form with a search box at the top that queries two sources at once:

- **[Open Food Facts](https://world.openfoodfacts.org/)** — a public, keyless database of mostly
  branded/packaged foods. Works immediately, no setup.
- **[USDA FoodData Central](https://fdc.nal.usda.gov/)** (Foundation, SR Legacy, and Branded
  datasets) — needs a free API key set in Settings first; get one at
  [fdc.nal.usda.gov/api-key-signup.html](https://fdc.nal.usda.gov/api-key-signup.html). Without a
  key, only Open Food Facts results show.

Results from both sources are merged into one list, each tagged with its source. Picking a result
prefills the serving size and nutrition fields, which you can still edit before saving. If one
source's request fails (e.g. an invalid USDA key), its results are just omitted rather than
blocking the other source's results.

Nutrition can always be entered manually instead, regardless of lookup availability.

### Multiple units per food

Nutrition is stored once, per the food's own serving. **Other Units** in the food form adds extra
ways to measure that same food, each written as an equivalence with a count on **both** sides: for
a tortilla recorded per `100 g`, `1 tortilla = 100 g` means logging *1 tortilla* and logging
*100 g* give identical nutrition, and a pack of six is `1 pack = 600 g`. Counting the left side
lets you enter whatever's written on the packaging without doing the division yourself —
`4 tray = 30 egg` records that a tray is 7.5 eggs.

The right-hand side doesn't have to be the serving unit either: it can be another unit defined on
the same food, so packaging that nests can be entered the way it's written —

```
1 tray = 5 box
1 box  = 6 egg
```

— and a tray resolves to 30 eggs by following the chain down to the serving unit. If a chain loops
(`1 box = 2 tray` alongside `1 tray = 3 box`) or points at a unit that isn't defined, the form says
so and those units simply aren't offered until it's fixed; nothing else is affected.

Everywhere an amount of a food is entered — a diary entry and a recipe ingredient — a unit
dropdown offers that food's whole serving, its serving unit, and each of these extra units, and the
nutrition is converted from whichever is picked. Nothing is duplicated: change the nutrition facts
once and every unit follows.

### Categories

Foods **and recipes** can each carry any number of free-form **categories** (e.g. `Protein`,
`Snack`, `Dairy`), added in their form: type a name and press Enter or **Add**. The field offers
every category already in use the moment you click it, and typing narrows the list; anything not on
it can just be typed. Categories are de-duplicated case-insensitively and always shown in
alphabetical order.

Categories **nest**, using `/` as the separator: `Protein/Meat/Poultry` is Poultry inside Meat
inside Protein. Typing a path creates every level it needs, so tagging a food `Protein/Meat` makes
`Protein` exist too. Filtering or grouping by a parent includes everything nested under it.

Both the Foods and the Recipes tab use categories three ways:

- **Filter** — the dropdown in the toolbar narrows the table to one category and everything nested
  under it, or to `(uncategorized)` for items with none.
- **Group by category** — the checkbox splits the table into a section per category, indented to
  show the tree, each with its own count. An item in several categories appears in each of their
  sections, and a parent still gets a header when only its subcategories have items. The checkbox
  state is remembered across reloads (per browser/client, not synced), separately per tab.
- **Sort** — click any column header (including **Brand** and **Categories**) to sort by it; click
  again to reverse.

A food's brand is free text with a dropdown of brands already in use, and foods are listed as
"Oats (Quaker)" wherever a food is picked, so two versions of the same thing stay apart.

The Diary tab's food picker is also grouped by category.

## Recipes

The **Recipes** tab builds recipes out of foods already in your database. A recipe has a name, a
servings count and serving unit (`serving`, `bowl`, `slice`...), any number of categories, and a
list of ingredients (food + amount, in that food's own serving unit). Nutrition per serving is
computed automatically from its ingredients and re-derives whenever an ingredient's underlying food
is edited — recipes never store their own copy of nutrition facts.

The tab filters, groups, and sorts by category exactly like the Foods tab does.

## Grocery tab

The **Grocery** tab is a manually maintained shopping list built from foods already in the
database. Pick a food, type an amount, and set a unit; the unit prefills from that food's serving
unit and can be changed per line, so a food measured in `100 g` for nutrition can be shopped for as
`2 loaf`.

Each line carries its own **brand**, prefilled from the food's brand and editable per line — handy
when you'll take whichever brand is cheapest. Each line also takes a free-text **comment** — "corn only", "brand X", "whatever's on offer" — set
when adding the line or edited in place afterwards.

Amounts are **entered by hand** — nothing is derived from recipes or the diary. Each line has a
checkbox for "bought", which strikes it through, and **Clear Checked** removes all ticked lines at
once. Amount and unit stay editable in place, and a line's unit dropdown also offers whatever
units its food defines, so `2 pack` is as easy to shop for as `500 g`.

**Group by category** splits the list into a section per category of the line's food — a shopping
list ordered by aisle, in effect. The checkbox state is remembered across reloads.

## Categories tab

The **Categories** tab manages the category tree itself:

- **Add Category** creates one up front, before anything uses it, so it's offered in the food and
  recipe forms from the start. The dropdown beside it picks a parent, or leave it on
  `(top level)`; a name containing `/` also creates a nested path directly.
- The **Foods** and **Recipes** columns count what carries each category directly, and in
  parentheses the total including its subcategories.
- The edit icon renames a category **everywhere at once** — every food and recipe using it is
  updated in the same save. Because the name is the full path, renaming also **moves** a category:
  renaming `Protein` to `Macros/Protein` carries `Protein/Meat` along as `Macros/Protein/Meat`.
  Renaming onto a name that already exists **merges** the two.
- The trash icon deletes a category **and its subcategories**, removing them from every food and
  recipe. It asks first, naming how many items are affected. The foods and recipes themselves are
  never deleted.

The list is the union of categories created here, any category an item actually carries, and every
parent those paths imply — so a category typed straight into a food form still appears here.

## Units tab

Foods, recipes and grocery lines share one unit vocabulary, and the **Units** tab manages it:

- **Add Unit** creates one up front, before anything uses it, so it's offered everywhere from the
  start.
- The **Foods**, **Recipes** and **Grocery** columns count what currently uses each unit.
- The edit icon renames a unit **everywhere at once** — every food, recipe and grocery line using
  it is updated in the same save. Renaming onto an existing unit **merges** the two, which is also
  how you consolidate `gram` and `g`.
- The trash icon deletes a unit. A unit still in use **cannot** be deleted: those records have to
  keep some unit, and the list would show it again regardless (it is the union of the managed list
  and what's in use). Rename it onto another unit first to move everything over, then delete it.

Every field that takes a unit — a food's serving unit, a recipe's serving unit (`serving`, `bowl`,
`slice`...), and each grocery line — offers this list as a dropdown the moment you click it. A unit
that isn't on the list can still just be typed, and it joins the vocabulary as soon as it's used.

## Diary

The **Diary** tab is the daily log. Pick a date (or use **Today**), then log foods or recipes
eaten that day with a servings multiplier. The day's running totals for every tracked nutrient are
shown against the daily targets configured in Settings, with any nutrient over target highlighted.

## Settings

Open the addon's launcher note for the settings screen:

- **USDA Lookup** — paste a USDA FoodData Central API key to include USDA results in food search.
  Open Food Facts results appear regardless of this setting.
- **Daily Targets** — a target value per tracked nutrient, compared against each day's diary
  totals. A target of `0` is treated as "no target" and shown without a comparison.
- **Render Note** — pick an existing note to become a second place the diet manager shows up.
  Selecting it converts that note into a render note pointing at the widget and stamps its icon;
  clearing it reverts the previously-chosen note back to a text note. **Apply render wiring**
  re-runs the wiring on the note already selected, for when it was set while the addon was
  disabled.

## Import and export

The tab bar's **Export JSON** downloads the whole database (categories, foods, recipes, diary, and
grocery list) as a `.json` file, and **Import JSON** loads one back in. Import **merges**: every
category, food, recipe, diary entry, and grocery line in the file is added by id alongside whatever
is already in the database, so importing the same file twice — or a partial export from another
install — never duplicates entries or wipes existing data. A file that isn't valid database JSON
reports an error and leaves the database untouched.

The import format is the [storage format](#storage-format) below.

## Storage format

The whole database is one JSON code note:

```json
{
    "categories": ["Protein", "Protein/Meat", "Snack"],
    "units": ["bowl", "g", "pack"],
    "foods": {
        "a1b2c3d4": {
            "id": "a1b2c3d4",
            "name": "Chicken Breast",
            "brand": "",
            "servingSize": 100,
            "servingUnit": "g",
            "portions": [{ "unit": "breast", "amount": 1, "size": 170, "sizeUnit": "g" }],
            "tags": ["Protein/Meat"],
            "nutrients": {
                "calories": 165, "protein": 31, "carbs": 0, "fat": 3.6,
                "fiber": 0, "sugar": 0, "saturatedFat": 1, "sodium": 74, "cholesterol": 85
            }
        }
    },
    "recipes": {
        "e5f6g7h8": {
            "id": "e5f6g7h8",
            "name": "Chicken Salad",
            "servings": 2,
            "servingUnit": "bowl",
            "tags": ["Protein"],
            "ingredients": [{ "foodId": "a1b2c3d4", "amount": 1, "unit": "breast" }]
        }
    },
    "diary": {
        "2026-07-22": [
            { "id": "i1j2k3l4", "kind": "food", "refId": "a1b2c3d4", "servings": 1, "unit": "breast", "loggedAt": "2026-07-22T12:00:00.000Z" }
        ]
    },
    "grocery": [
        { "id": "m1n2o3p4", "foodId": "a1b2c3d4", "brand": "Store own", "amount": 2, "unit": "pack", "comment": "corn only", "done": false }
    ]
}
```

A food's or recipe's `tags` array is its categories, each a `/`-separated path; an item saved before
categories existed simply has none. The top-level `categories` array is the managed list — it only
needs to hold categories nothing carries yet, since the tab shows the union of the two plus every
implied parent, and it may be absent entirely in an older database. `grocery` is likewise optional
and its lines are independent of the diary. `units` is the managed unit list, and like `categories`
it only needs to hold units nothing uses yet.
A food's `portions` are its extra units: `amount` of `unit` equals `size` of `sizeUnit`, so one of
that unit is `size / amount` of `sizeUnit`. `sizeUnit` may name another portion (chains resolve down
to the serving unit) and defaults to the serving unit when absent; a missing `amount` is one of them.
Both defaults are what portions meant before either side could be varied. A diary
entry's or ingredient's `unit` says which unit its amount is in; an entry with no `unit` counts whole
servings and an ingredient with no `unit` is an amount in the serving unit, which is exactly what
they meant before units existed, so older databases keep their totals.

Diary entries are keyed by ISO date (`YYYY-MM-DD`). A recipe's own nutrition is never stored — it's
always recomputed from its current ingredients at render time, same as a diary entry's contribution
is always recomputed from the food or recipe it references.

## Limitations

- Both lookup sources search by name only; there's no barcode scanning.
- Open Food Facts is community-sourced and doesn't always report every nutrient (cholesterol in
  particular is often missing); missing values default to 0 rather than being left blank.
- A deleted food or recipe leaves any recipe ingredient or diary entry that referenced it showing
  as "(deleted)" rather than being cleaned up automatically.
