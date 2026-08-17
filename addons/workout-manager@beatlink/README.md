# Workout Manager

An exercise library, reusable routines, and a workout log, in one widget. All data — categories,
exercises, routines and every logged workout — lives in one persisted JSON note, so it's a single
note you can back up, inspect, or migrate.

## Setup

1. Install the addon and enable it.
2. Open its launcher note (`workout-manager@beatlink`) to use the widget.
3. Optionally, open the addon's settings screen to pick weight/distance units, a default rest time,
   and how many workouts a week you're aiming for.

## Exercises

The **Exercises** tab is the library everything else refers to. Each exercise has a name, how it is
measured, optional equipment, the muscles it works, categories, and free-text notes.

**Measured as** decides which fields a set of that exercise carries, everywhere it appears:

| Measured as | A set records |
|-------------|---------------|
| Weight & Reps | reps and weight |
| Bodyweight Reps | reps |
| Duration | duration in minutes |
| Cardio | duration in minutes and distance |

Every set also has an optional RPE. The measurement is a property of the exercise, so changing it
changes which fields are shown for sets already logged — the recorded numbers themselves are never
touched.

### wger lookup

**Add Exercise** opens a form with a search box that queries the public
[wger](https://wger.de) exercise database — around 850 exercises, no account and no API key needed.
Picking a result prefills the name, equipment, muscles and the wger category (as a Trilium-side
category tag), and guesses the measurement: anything in wger's *Cardio* category becomes Cardio,
anything needing no equipment becomes Bodyweight Reps, everything else Weight & Reps. Everything is
still editable before saving, and exercises can always be typed in entirely by hand instead.

wger's API has no substring search endpoint, so the whole English exercise index is fetched once per
page load (a few seconds on the first search, instant afterwards) and searched locally. If wger is
unreachable, the form says so and manual entry carries on working.

## Routines

A routine is a plan: an ordered list of exercises, each with a number of sets, the targets those
sets aim at, a rest time, and an optional note. Which targets a routine entry offers follows the
exercise's own measurement — a Weight & Reps exercise asks for reps and weight, a Cardio one for
duration and distance.

**Start Today** on a routine creates a workout in today's log, pre-filled: one entry per routine
exercise, with that entry's sets already created at its target numbers. Logging is then a matter of
correcting what actually happened.

Routines are plans only. Editing or deleting a routine never changes a workout already logged from
it.

## Log

The **Log** tab is one day at a time — arrows step a day, the date field jumps anywhere, **Today**
comes back. A day holds any number of workouts, each of which can be started from a routine or
created empty and filled in as you go.

Everything in a logged workout is edited in place and saved as you type: its name and note, the
exercises in it, and each set's numbers. **Add Set** copies the previous set of the same exercise,
since sets usually repeat the previous load. The workout header totals its sets, its volume
(weight × reps, for weight-based exercises), and any duration and distance in it.

Deleting an exercise from the library leaves workouts that used it alone — those sets stay in the
log and show as *Deleted exercise* rather than silently disappearing.

## Stats

Two tables:

- **Last 8 weeks** — workouts (against the weekly target from settings), sets, volume, duration and
  distance per training week, weeks starting Monday.
- **Personal bests** — per exercise, the best result that means something for its measurement:
  heaviest weight plus estimated 1RM (Epley: `weight × (1 + reps / 30)`) for weight training, most
  reps for bodyweight, longest duration, or furthest distance. Also total sets, total volume, and
  when it was last done. The history button expands every set ever recorded for that exercise, newest
  first.

## Categories

Exercises and routines share one set of categories, which nest with `/`: `Push/Chest` is Chest
inside Push. The category list is the union of the categories you create here and any typed straight
into an exercise or routine form, so nothing is ever hidden. Renaming a category takes its subtree
with it, and renaming onto an existing name merges the two. Deleting a category removes it (and its
subcategories) from everything tagged with it; the exercises and routines themselves are kept.

## Units

Weights and distances are plain numbers labelled with the units chosen in settings (kg/lb, km/mi).
Switching a unit relabels what is displayed — it never converts or rewrites recorded numbers.

## Import and export

**Export JSON** downloads the whole database as one file. **Import JSON** merges such a file back in
by id: exercises and routines are added alongside what's already there, and workouts already present
are skipped, so importing the same file twice changes nothing and nothing is ever wiped.

## Settings

| Setting | Description |
|---------|-------------|
| Weight Unit | Label shown beside every weight (kg or lb). |
| Distance Unit | Label shown beside every cardio distance (km or mi). |
| Default Rest | Rest seeded into a new routine entry. |
| Workouts Per Week | The target each week in the Stats tab is measured against. |
| Render Note | An existing note to turn into a second view of the widget. Selecting it converts that note into a render note; clearing it reverts the previous one to a text note. |

## Credits

Exercise data comes from [wger](https://wger.de), licensed
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
