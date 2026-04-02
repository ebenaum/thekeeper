# Edition Management Design

## Problem

All characters exist in a single flat pool. With the 2026 edition launching, organizers need a view that only shows characters enrolled for 2026 — without 2025 characters that aren't coming back polluting aggregates and lists. Players should still see all their characters across editions.

## Solution: Edition Tag on Characters

An edition is a string label (`"2025"`, `"2026"`, `"optout"`). A new `ActivateCharacter` event associates a character with an edition. The most recent `ActivateCharacter` event for a given character determines its current edition status.

## New Event Type

**`ActivateCharacter`** (protobuf):
- `character_id` (string): the character being tagged
- `edition` (string): one of `"2025"`, `"2026"`, `"optout"`

**Backend validation** (`SpaceValidation`): reject any `ActivateCharacter` event where `edition` is not one of the three allowed values.

**Authorization**: a player can only activate their own characters. Standard permission model applies.

## Migration

A CLI command (`migrate-editions` or similar) replays all existing events, identifies every character, and inserts an `ActivateCharacter` event with edition `"2025"` for each.

## Projection Changes

Both orga and player projections pass `ActivateCharacter` events through to the frontend. Edition filtering is handled entirely on the frontend side.

### Orga View (frontend)
- Only displays characters whose most recent `ActivateCharacter` event has edition `"2026"`.
- Aggregate stats (faction counts, etc.) computed only from 2026 characters.
- Characters with `"2025"` or `"optout"` as latest status are hidden.
- Players with no 2026 characters are hidden.

### Player View (frontend)
- Shows all characters as before.
- Each character displays its current edition status (`"2025"`, `"2026"`, or `"optout"`) with appropriate actions.

## Frontend Behavior

### Player View
- All characters shown, labeled by edition status.
- **2025 characters**: "Enroll for 2026" action available.
- **2026 characters**: "Opt out" action available.
- **Opted-out characters**: "Enroll for 2026" action available.
- **New character creation**: automatically emits an `ActivateCharacter` event with edition `"2026"` alongside the character creation event.

### Orga View
- Only 2026 characters visible.
- No edition management actions from the orga side.

## Edition Status Lifecycle

Opt-out is reversible. A character can transition freely between statuses via new `ActivateCharacter` events:

```
2025 -> 2026      (returning player enrolls old character)
2025 -> optout    (player opts out old character)
2026 -> optout    (player opts out enrolled character)
optout -> 2026    (player re-enrolls after opting out)
```

The system always uses the most recent `ActivateCharacter` event for a character to determine its current status.
