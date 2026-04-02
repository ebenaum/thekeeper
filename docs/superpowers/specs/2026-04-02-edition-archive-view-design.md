# Edition Archive View — Design Spec

## Problem

Orga views (index.html home, theview, theview2) currently only show 2026 characters. Orgas need to browse the 2025 roster for reference/archival purposes.

## Solution

Add an edition dropdown selector to each orga view, allowing orgas to switch between 2026 and 2025 character lists.

## Edition Selector

- A `<select>` element at the top of each orga view (index.html home, theview, theview2)
- Two options: "Édition 2026" (default), "Édition 2025"
- Selecting an edition re-filters the character list in place (no page reload)

## Filtering Logic

- **2026 selected:** `character.edition === "2026"` — current behavior, unchanged
- **2025 selected:** `character.editionHistory?.includes("2025")` — shows any character that participated in the 2025 edition, regardless of their current edition status (2025, 2026, or optout)

## Read-Only Behavior (2025 View)

When viewing the 2025 roster:

- No edition action buttons (enroll/opt-out) displayed
- No edit links on character cards (or links disabled/hidden)
- Edition badges still rendered to reflect the character's current edition status
- The view is strictly read-only — orgas can browse but not act

## Scope

- **Frontend only** — changes in `app.js` and `index.html`
- **No backend changes**
- **Three views to update:** `index()`, `theview()`, `theview2()`

## Implementation Notes

- The selector should be placed consistently at the top of each view, before the character list
- Changing the selector value should re-render the view with the new filter applied
- Empty state message should adapt: e.g. "Aucun joueur inscrit pour l'édition 2025" when no matches
