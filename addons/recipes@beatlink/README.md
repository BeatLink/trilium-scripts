# Recipes

A food and recipe database with a daily nutrition diary, built to replace Cronometer. All data —
foods, recipes, and the diary — lives in one persisted JSON note, so it's a single note you can
back up, inspect, or migrate.

## Setup

1. Install the addon and enable it.
2. Open its launcher note (`recipes@beatlink`) to use the widget.
3. Optionally, open the addon's settings screen to set daily nutrient targets and a USDA
   FoodData Central API key for food lookup.

## Foods

The **Foods** tab is your ingredient database. Each food has a name, a serving size/unit (e.g.
"100 g" or "1 cup"), and nutrition facts *per that serving*: calories, protein, carbs, fat, fiber,
sugar, saturated fat, sodium, and cholesterol.

**Add Food** opens a form with a USDA search box at the top. Search pulls matching foods from
[USDA FoodData Central](https://fdc.nal.usda.gov/) (Foundation, SR Legacy, and Branded datasets);
picking a result prefills the serving size and nutrition fields, which you can still edit before
saving. Search is disabled until an API key is set in Settings — get a free one at
[fdc.nal.usda.gov/api-key-signup.html](https://fdc.nal.usda.gov/api-key-signup.html).

Nutrition can always be entered manually instead, with or without an API key.

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

- **USDA Lookup** — paste a USDA FoodData Central API key to enable food search.
- **Daily Targets** — a target value per tracked nutrient, compared against each day's diary
  totals. A target of `0` is treated as "no target" and shown without a comparison.

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

- No import/export UI yet — the database note's own content is the backup/migration path (copy its
  JSON directly).
- USDA lookup searches by name only; there's no barcode scanning.
- A deleted food or recipe leaves any recipe ingredient or diary entry that referenced it showing
  as "(deleted)" rather than being cleaned up automatically.
