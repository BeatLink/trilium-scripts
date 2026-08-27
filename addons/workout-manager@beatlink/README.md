# Workout Manager

An exercise library, reusable training programs, and a workout log, in one widget. Plans are
organised as **Program -> Session -> Exercise**: a program is a training block such as Push/Pull/Legs,
a session is one day of it, and each session lists the exercises it works through. All data —
categories, exercises, programs and every logged workout — lives in one persisted JSON note, so it's
a single note you can back up, inspect, or migrate.

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

## Programs and sessions

The **Programs** tab holds the plans, two levels deep. A **program** is a named training block that
groups the sessions belonging to it. A **session** is one day of that program: an ordered list of
exercises, each with a number of sets, the targets those sets aim at, a rest time, and an optional
note. Which targets a session entry offers follows the exercise's own measurement — a Weight & Reps
exercise asks for reps and weight, a Cardio one for duration and distance.

Type a name and **Add Program** to create a program; **Add Session** inside one adds a session to it.
The arrows on a session move it up and down, and that order is the order the program runs in. A
session belongs to exactly one program, so putting the same day in two programs means copying it.

Categories are tagged on sessions rather than on programs, so a session can be filed under Push or
Upper without the whole program having to be.

**Start Today** on a session creates a workout in today's log, pre-filled: one entry per session
exercise, with that entry's sets already created at its target numbers. Logging is then a matter of
correcting what actually happened. The logged workout is named after both, as `Program - Session`.

Programs and sessions are plans only. Editing or deleting either never changes a workout already
logged from it, and a plan only moves on its own if the exercise has a **progression**.

## Progression

A session exercise can carry a progression: a rule that reads what you actually did and moves that
exercise's own targets for next time. The three rules are the ones
[Liftosaur](https://www.liftosaur.com/doc/liftoscript) builds in, and they behave the way its own
scripts do.

| Progression | Parameters | What it does |
|-------------|------------|--------------|
| **Linear** | increase, after N successes, decrease, after N failures | Adds weight once you hit every set at its target reps N workouts running. Optionally takes weight back off after N missed workouts. |
| **Double** | increase, min reps, max reps | Walks the reps up one per workout inside the range. On reaching the top, adds weight instead and drops the reps back to the minimum. |
| **Sum of Reps** | total reps, increase | Adds weight whenever the reps across all sets clear the threshold, however they were split up. |

Both weight steps can be an absolute amount or a percentage — the dropdown beside the number
switches between `kg`/`lb` and `%`.

All three move weight, so a progression is only offered on a **Weight & Reps** exercise. Progression
belongs to one exercise in one session: the same exercise in two sessions of a program progresses
separately, each with its own targets and its own counters.

### How it decides

- A workout **meets** the target when at least the prescribed number of sets were logged and every
  logged set reached the target reps. The weakest set is what counts.
- An **increase** is applied to the weight you actually lifted, so a set logged heavier than planned
  carries that into the next target. A **decrease** comes off the weight that was planned.
- **Sum of Reps** ignores whether individual sets met their target — only the total matters.
- Linear counts attempts across workouts, and a missed workout leaves the success count standing
  rather than resetting it. The Finish report shows where the count stands (`2/3 successes`).

### Finishing a workout

Progression runs when you press **Finish** on a logged workout, which appears on any workout started
from a session. Finishing:

1. Compares each exercise against the targets recorded **when the workout was started**, so a plan
   that has moved since does not change the verdict.
2. Rewrites the session's targets and counters.
3. Marks the workout finished, so pressing it again does nothing.

A report under the workout header says what moved (`Bench Press: 60 → 62.5 kg`) and what did not
(`Squat: unchanged (1/3 successes)`). Finishing is one-way: deleting the workout afterwards does not
put the session's targets back, so correct them by hand if you finish one by mistake. Editing a
finished workout is still allowed; it just will not progress the plan a second time.

## Log

The **Log** tab is one day at a time — arrows step a day, the date field jumps anywhere, **Today**
comes back. A day holds any number of workouts, each of which can be started from a session (the
picker groups sessions under their program) or created empty and filled in as you go.

Workouts started from a session get a **Finish** button, which applies that session's progressions —
see [Progression](#progression). Everything else in a logged workout is edited in place and saved as
you type: its name and note, the exercises in it, and each set's numbers. **Add Set** copies the previous set of the same exercise,
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

Exercises and sessions share one set of categories, which nest with `/`: `Push/Chest` is Chest
inside Push. The category list is the union of the categories you create here and any typed straight
into an exercise or session form, so nothing is ever hidden. Renaming a category takes its subtree
with it, and renaming onto an existing name merges the two. Deleting a category removes it (and its
subcategories) from everything tagged with it; the exercises and sessions themselves are kept.

## Units

Weights and distances are plain numbers labelled with the units chosen in settings (kg/lb, km/mi).
Switching a unit relabels what is displayed — it never converts or rewrites recorded numbers.

## Import and export

**Export JSON** downloads the whole database as one file. **Import JSON** merges such a file back in
by id: exercises and programs are added alongside what's already there, sessions are merged into a
program already present rather than replacing it, and workouts already present are skipped, so
importing the same file twice changes nothing and nothing is ever wiped.

A file exported before programs existed is upgraded on the way in: each routine it holds becomes a
session, and all of them are gathered into one program named **Imported**, which you can then split
up. Workouts logged from those routines keep pointing at the right session.

### Importing from Liftosaur

**Import Liftosaur** takes either file [Liftosaur](https://liftosaur.com) exports and merges it in
the same way:

- the full JSON backup — Settings → *Export data to file*, saved as `liftosaur-YYYYMMDD.json`
- the history CSV — *Export history to CSV*

Both bring in every workout, its exercises, and each performed set's reps, weight and RPE. Ids are
derived from the Liftosaur data rather than generated, so re-importing a newer export adds only the
workouts that weren't there before.

Which file to prefer: the **CSV** names exercises the way the app displays them (`Bench Press,
Barbell`) and carries target/synergist muscles for every exercise. The **JSON** identifies built-in
exercises by their internal id, so their names are reconstructed from it (`benchPress` → `Bench
Press`) and only custom exercises bring muscles along. The CSV therefore gives a tidier library; the
JSON is the complete backup.

What is not imported:

- **Warmup sets** and sets that were never performed — both are counted in the summary message.
- **Programs.** A Liftosaur program is Liftoscript, which computes sets and weights per workout, so
  programs and sessions are left to you to write. Its three built-in progressions are available
  natively though — see [Progression](#progression) — so `progress: lp(5lb)` on a Liftosaur exercise
  becomes a Linear progression on the matching session exercise. `progress: custom()` scripts have
  no equivalent.
- Everything Liftosaur logs is reps and weight, so imported exercises come in as Weight & Reps, or
  as Bodyweight Reps when no set ever carried weight. Change an exercise's measurement afterwards if
  it should be Duration or Cardio.

Liftosaur stores every weight with its own unit. The import converts them all onto one unit and the
summary says which — if that isn't the unit set in settings, change **Weight Unit** to match, since
this addon labels weights rather than converting them.

## Settings

| Setting | Description |
|---------|-------------|
| Weight Unit | Label shown beside every weight (kg or lb). |
| Distance Unit | Label shown beside every cardio distance (km or mi). |
| Default Rest | Rest seeded into a new session entry. |
| Workouts Per Week | The target each week in the Stats tab is measured against. |
| Render Note | An existing note to turn into a second view of the widget. Selecting it converts that note into a render note; clearing it reverts the previous one to a text note. |

## Credits

Exercise data comes from [wger](https://wger.de), licensed
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
