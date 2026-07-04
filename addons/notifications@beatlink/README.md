# Notifications

Polls for notes matching a configurable date label and sends a desktop notification when a note's date is past due.

## Setup

Add the following labels to a note that should drive the notifications:

| Label          | Value    | Description                                               |
|----------------|----------|-----------------------------------------------------------|
| `enabled`      | `true`   | Enable notifications for this note                        |
| `dateLabel`    | string   | Name of the label to search for (e.g. `dueDate`)         |
| `reminderTime` | number   | Polling interval in seconds                               |
| `earliest`     | `true`/`false` | Whether to notify on the earliest or latest match   |

## How it works

On startup the script searches for notes where `#{dateLabel}` is set to a past date/time, picks the earliest (or latest) match, and sends a desktop notification via the [Notification Library](../libnotification@beatlink/). It then reschedules itself after `reminderTime` seconds.
