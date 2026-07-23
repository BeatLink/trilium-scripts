# Recipes

A food and recipe database with a daily nutrition diary, built to replace Cronometer. All data —
foods, recipes, and the diary — lives in one persisted JSON note, so it's a single note you can
back up, inspect, or migrate.

## Setup

1. Install the addon and enable it.
2. Open its launcher note (`recipes@beatlink`) to use the widget.
3. Optionally, open the addon's settings screen to set daily nutrient targets and a USDA
   FoodData Central API key for food lookup (Open Food Facts lookup needs no key and works out of
   the box).

## Foods

The **Foods** tab is your ingredient database. Each food has a name, a serving size/unit (e.g.
"100 g" or "1 cup"), and nutrition facts *per that serving*: calories, protein, carbs, fat, fiber,
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

## Recipes

The **Recipes** tab builds recipes out of foods already in your database. A recipe has a name, a
servings count, and a list of ingredients (food + amount, in that food's own serving unit).
Nutrition per serving is computed automatically from its ingredients and re-derives whenever an
ingredient's underlying food is edited — recipes never store their own copy of nutrition facts.

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

## Import and export

The tab bar's **Export JSON** downloads the whole database (foods, recipes, and diary) as a
`.json` file, and **Import JSON** loads one back in. Import **merges**: every food, recipe, and
diary entry in the file is added by id alongside whatever's already in the database, so importing
the same file twice — or a partial export from another install — never duplicates entries or wipes
existing data. A file that isn't valid database JSON reports an error and leaves the database
untouched.

The import format is the [storage format](#storage-format) below.

## Storage format

The whole database is one JSON code note:

```json
{
    "foods": {
        "a1b2c3d4": {
            "id": "a1b2c3d4",
            "name": "Chicken Breast",
            "servingSize": 100,
            "servingUnit": "g",
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
            "ingredients": [{ "foodId": "a1b2c3d4", "amount": 200 }]
        }
    },
    "diary": {
        "2026-07-22": [
            { "id": "i1j2k3l4", "kind": "food", "refId": "a1b2c3d4", "servings": 1, "loggedAt": "2026-07-22T12:00:00.000Z" }
        ]
    }
}
```

Diary entries are keyed by ISO date (`YYYY-MM-DD`). A recipe's own nutrition is never stored — it's
always recomputed from its current ingredients at render time, same as a diary entry's contribution
is always recomputed from the food or recipe it references.

## Limitations

- Both lookup sources search by name only; there's no barcode scanning.
- Open Food Facts is community-sourced and doesn't always report every nutrient (cholesterol in
  particular is often missing); missing values default to 0 rather than being left blank.
- A deleted food or recipe leaves any recipe ingredient or diary entry that referenced it showing
  as "(deleted)" rather than being cleaned up automatically.
