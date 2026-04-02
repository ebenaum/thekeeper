# Edition Archive View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let orgas switch between 2026 and 2025 character views via an edition dropdown on index.html, theview, and theview2.

**Architecture:** Add a `<select>` dropdown at the top of each orga view. The selected edition drives the existing character filter logic. 2025 filtering uses `editionHistory?.includes("2025")` instead of `edition === "2025"`. When viewing 2025, character cards are read-only (no action buttons, no edit links).

**Tech Stack:** Vanilla JS, HTML

---

### Task 1: Add edition selector to index.html and wire it into `index()`

**Files:**
- Modify: `public/index.html:59-66`
- Modify: `public/app.js:2700-2904`

- [ ] **Step 1: Add the `<select>` element to index.html**

In `public/index.html`, add the edition selector inside the `.container` div, between the `<h1>` and the `.character-list` div:

```html
<select id="edition-selector" class="edition-selector d-none">
  <option value="2026" selected>Édition 2026</option>
  <option value="2025">Édition 2025</option>
</select>
```

The selector starts hidden (`d-none`) and will only be shown for orga users via JS.

- [ ] **Step 2: Show the selector for orga users and wire up re-rendering in `index()`**

In `public/app.js`, inside the `index()` function, after the state is loaded and permission is known (after line 2698 where the early-return for non-authenticated users ends), add logic to:

1. Show the selector if the user is an orga
2. Read the selected edition value
3. Use it to drive filtering

Replace the player iteration block (lines 2700-2904) with a `renderIndex` inner function that:
- Reads the selected edition from `#edition-selector`
- Clears `characterListElement` before re-rendering
- Filters characters based on selected edition:
  - `"2026"`: `character.edition === "2026"` (existing logic)
  - `"2025"`: `character.editionHistory?.includes("2025")`
- When edition is `"2025"`:
  - Hides the "Créer un personnage" link
  - Hides edition action buttons (`.character-edition-action`)
  - Changes "Voir / Éditer" to "Voir" on character links
- Adapts the empty-state message: `"Aucun joueur inscrit pour l'édition ${edition} pour le moment."`

```javascript
// After state is loaded and permission checks are done (after line 2698):

const editionSelector = /** @type {HTMLSelectElement | null} */ (document.querySelector("#edition-selector"));

if (state.data.permission === "orga" && editionSelector) {
  editionSelector.classList.remove("d-none");
  editionSelector.addEventListener("change", () => renderIndex());
}

function renderIndex() {
  const selectedEdition = editionSelector?.value || "2026";

  // Clear previous render
  while (characterListElement?.firstChild) {
    characterListElement.removeChild(characterListElement.firstChild);
  }

  Object.keys(state.data.players).forEach((playerId) => {
    const player = state.data.players[playerId];

    // Hide PNJ for orgas.
    if (player.personal?.inscriptionType === "pnj") {
      return;
    }

    const clone = /** @type {HTMLElement} */ (
      playerTemplate.content.cloneNode(true)
    );

    const shareElement = /** @type {HTMLElement} */ (
      clone.querySelector(".player-card__sharelink")
    );

    if (state.data.permission === "orga") {
      shareElement.textContent = "Lien de partage";
      shareElement.setAttribute("data-handle", player.handle);
    }

    const nameElement = /** @type {HTMLElement} */ (
      clone.querySelector(".index__player__head__name")
    );

    const playerTypeLabel = { pj: "PJ", pnj: "PNJ", unknown: "Inscrit" }[
      player.personal?.inscriptionType || "unknown"
    ];
    nameElement.textContent = `${playerTypeLabel} : ${player.personal?.surname || "Sans nom"}`;

    const aElement = /** @type {HTMLElement} */ (clone.querySelector("a"));
    aElement.setAttribute("href", "/informations.html?playerId=" + playerId);

    const charactersElement = /** @type {HTMLElement} */ (
      clone.querySelector(".index__player__characters")
    );

    const createCharacterElement = /** @type {HTMLElement} */ (
      clone.querySelector(".index__player__characters__create")
    );
    createCharacterElement.setAttribute(
      "href",
      "/personnage.html?playerId=" + playerId,
    );

    // Hide "Créer un personnage" when viewing archive
    if (selectedEdition !== "2026") {
      createCharacterElement.classList.add("d-none");
    }

    const visibleCharacters = state.data.permission === "orga"
      ? player.characters.filter((cid) => {
          const c = state.data.characters[cid];
          if (!c) return false;
          if (selectedEdition === "2026") return c.edition === "2026";
          return c.editionHistory?.includes("2025");
        })
      : player.characters;

    if (state.data.permission === "orga" && visibleCharacters.length === 0) {
      return;
    }

    visibleCharacters.forEach((characterId) => {
      const character = state.data.characters[characterId];
      if (!character) {
        console.warn(
          `Character with ID ${characterId} not found for player ${playerId}`,
        );
        return;
      }
      const characterClone = /** @type {HTMLElement} */ (
        characterTemplate.content.cloneNode(true)
      );
      const characterNameElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(
          ".index__player__characters__character__name",
        )
      );

      const characterPeekElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(
          ".index__player__characters__character__peek",
        )
      );

      const characterLinkElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(
          ".index__player__characters__character__link",
        )
      );
      characterLinkElement.setAttribute(
        "href",
        `/personnage.html?characterId=${characterId}`,
      );

      const characterFinalLinkElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(
          ".index__player__characters__character__final__link",
        )
      );
      characterFinalLinkElement.setAttribute(
        "href",
        `/print.html?characterId=${characterId}`,
      );

      const characterReviewedBadgeElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(".character-reviewed-badge")
      );

      if (character.orga?.playerGroup) {
        characterReviewedBadgeElement.classList.remove("d-none");
        characterFinalLinkElement.classList.remove("d-none");
      } else {
        characterLinkElement.classList.remove("d-none");
      }

      if (state.data.permission === "orga") {
        characterLinkElement.classList.remove("d-none");
      }

      const characterName = character.name || "Sans nom";
      characterNameElement.textContent = characterName;

      let characterPeek = [];
      characterPeek.push(universMap[character.group]?.label);
      characterPeek.push(universMap[character.race]?.label);
      characterPeek.push(universMap[character.vdv]?.label);

      characterPeek = characterPeek.filter((n) => n);

      characterPeekElement.textContent = characterPeek.join(" - ");

      const editionBadgeElement = /** @type {HTMLElement} */ (
        characterClone.querySelector(".character-edition-badge")
      );
      const editionActionElement = /** @type {HTMLButtonElement} */ (
        characterClone.querySelector(".character-edition-action")
      );

      const edition = character.edition || "2025";
      editionBadgeElement.textContent = edition === "optout" ? "Non inscrit" : "Édition " + edition;
      editionBadgeElement.classList.add("character-edition-badge--" + edition);

      if (edition !== "2026") {
        characterLinkElement.textContent = "Voir";
      }

      // Read-only for archive view: hide all action buttons
      if (selectedEdition !== "2026") {
        characterLinkElement.textContent = "Voir";
      } else if (state.data.permission !== "orga") {
        // Edition action buttons only for non-orga on 2026 view (existing logic)
        if (edition === "2026") {
          editionActionElement.textContent = "Retirer de l'édition 2026";
          editionActionElement.classList.remove("d-none");
          editionActionElement.addEventListener("click", async () => {
            const payload = create(EventsSchema, {
              events: [
                {
                  msg: {
                    case: "ActivateCharacter",
                    value: { characterId: characterId, edition: "optout" },
                  },
                },
              ],
            });
            await fetch(`${globalThis.env.thekeeperURL}/state`, {
              method: "POST",
              headers: {
                Authorization: await auth(state.keys.private, state.keys.public),
                "Content-Type": "application/x-protobuf",
              },
              body: toBinary(EventsSchema, payload),
            });
            window.location.reload();
          });
        } else {
          editionActionElement.textContent = "Inscrire pour 2026";
          editionActionElement.classList.remove("d-none");
          editionActionElement.addEventListener("click", async () => {
            const payload = create(EventsSchema, {
              events: [
                {
                  msg: {
                    case: "ActivateCharacter",
                    value: { characterId: characterId, edition: "2026" },
                  },
                },
              ],
            });
            await fetch(`${globalThis.env.thekeeperURL}/state`, {
              method: "POST",
              headers: {
                Authorization: await auth(state.keys.private, state.keys.public),
                "Content-Type": "application/x-protobuf",
              },
              body: toBinary(EventsSchema, payload),
            });
            window.location.reload();
          });
        }
      }

      charactersElement.prepend(characterClone);
    });

    characterListElement?.prepend(clone);
  });

  if (state.data.permission === "orga" && characterListElement?.children.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.textContent = `Aucun joueur inscrit pour l'édition ${selectedEdition} pour le moment.`;
    placeholder.style.textAlign = "center";
    placeholder.style.opacity = "0.6";
    placeholder.style.padding = "2em 0";
    characterListElement.appendChild(placeholder);
  }

  containerElement
    ?.querySelectorAll(".player-card__sharelink")
    .forEach((span) => {
      span.addEventListener("click", async (e) => {
        e.preventDefault();
        const handle = span.getAttribute("data-handle");
        if (handle) {
          navigator.clipboard.writeText(handle);

          const response = await fetch(
            `${globalThis.env.thekeeperURL}/auth/handles/${handle}`,
            {
              method: "POST",
              headers: {
                Authorization: await auth(
                  state.keys.private,
                  state.keys.public,
                ),
                "Content-Type": "application/json",
              },
            },
          );

          const data = await response.json();
          span.textContent = data.shareLink;
        }
      });
    });
}

// Initial render
renderIndex();
```

- [ ] **Step 3: Test manually**

Open the app as an orga user. Verify:
- The edition selector appears at the top of the home page
- Switching to "Édition 2025" shows characters with 2025 in their history
- 2025 view has no action buttons and "Voir" instead of "Voir / Éditer"
- "Créer un personnage" link is hidden in 2025 view
- Empty state message adapts to selected edition
- Switching back to 2026 restores original behavior
- Non-orga users do not see the selector

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: add edition selector to orga home page"
```

---

### Task 2: Add edition selector to theview

**Files:**
- Modify: `public/theview.html:39-41`
- Modify: `public/app.js:2313-2510` (the `theview()` function)

- [ ] **Step 1: Add the `<select>` element to theview.html**

In `public/theview.html`, add the edition selector inside the body, before the `#thetable` div:

```html
<select id="edition-selector" class="edition-selector">
  <option value="2026" selected>Édition 2026</option>
  <option value="2025">Édition 2025</option>
</select>
<div id="thetable"></div>
```

No `d-none` needed here — theview is orga-only.

- [ ] **Step 2: Wire the selector into `theview()`**

In `public/app.js`, in the `theview()` function, wrap the table-building and DataTable init logic into an inner `renderTheview()` function (same pattern as Task 1's `renderIndex()`). This avoids re-fetching state/univers on each toggle and prevents stacking event listeners.

1. After state is loaded (line 2327), get the selector and set up the change listener (once):

```javascript
const editionSelector = /** @type {HTMLSelectElement | null} */ (document.querySelector("#edition-selector"));

if (editionSelector) {
  editionSelector.addEventListener("change", () => {
    // Destroy existing DataTable and clear container
    if (window.DataTable.isDataTable("#theview")) {
      new window.DataTable("#theview").destroy();
    }
    containerElement.innerHTML = "";
    renderTheview();
  });
}

function renderTheview() {
  const selectedEdition = editionSelector?.value || "2026";
  // ... existing table-building code from lines 2331-2510,
  // but with the filter replaced (see below)
}

// Initial render
renderTheview();
```

2. Inside `renderTheview()`, replace the character filter at line 2371-2372:

```javascript
// Was: .filter((cid) => state.data.characters[cid]?.edition === "2026")
const characters = player.characters
  .filter((cid) => {
    const c = state.data.characters[cid];
    if (!c) return false;
    if (selectedEdition === "2026") return c.edition === "2026";
    return c.editionHistory?.includes("2025");
  });
```

- [ ] **Step 3: Test manually**

Open theview as an orga. Verify:
- Edition selector appears above the table
- Switching to 2025 shows characters with 2025 history
- Switching back to 2026 shows only current 2026 characters
- Table re-renders correctly with DataTable features intact

- [ ] **Step 4: Commit**

```bash
git add public/theview.html public/app.js
git commit -m "feat: add edition selector to theview"
```

---

### Task 3: Add edition selector to theview2

**Files:**
- Modify: `public/theview2.html:22-32`
- Modify: `public/app.js:2207-2311` (the `theview2()` function)

- [ ] **Step 1: Add the `<select>` element to theview2.html**

In `public/theview2.html`, add the edition selector inside `.theview2`, before the first child `<div>`:

```html
<div class="theview2">
  <select id="edition-selector" class="edition-selector">
    <option value="2026" selected>Édition 2026</option>
    <option value="2025">Édition 2025</option>
  </select>
  <div>
    <h1>Inventaire global</h1>
```

- [ ] **Step 2: Wire the selector into `theview2()`**

In `public/app.js`, in the `theview2()` function, wrap the aggregation and rendering logic into an inner `renderTheview2()` function (same pattern as Tasks 1 and 2). This avoids re-fetching state/univers on each toggle and prevents stacking event listeners.

1. After state is loaded and DOM elements are grabbed (after line 2230), set up the selector and change listener (once):

```javascript
const editionSelector = /** @type {HTMLSelectElement | null} */ (document.querySelector("#edition-selector"));

if (editionSelector) {
  editionSelector.addEventListener("change", () => {
    inventoryElement.innerHTML = "";
    skillsElement.innerHTML = "";
    renderTheview2();
  });
}

function renderTheview2() {
  const selectedEdition = editionSelector?.value || "2026";
  // ... existing aggregation + rendering code from lines 2232-2310,
  // but with the filter replaced (see below)
}

// Initial render
renderTheview2();
```

2. Inside `renderTheview2()`, replace the character filter at line 2238:

```javascript
// Was: .filter((cid) => state.data.characters[cid]?.edition === "2026")
Object.keys(state.data.characters)
  .filter((cid) => {
    const c = state.data.characters[cid];
    if (!c) return false;
    if (selectedEdition === "2026") return c.edition === "2026";
    return c.editionHistory?.includes("2025");
  })
  .forEach((characterId) => {
```

- [ ] **Step 3: Test manually**

Open theview2 as an orga. Verify:
- Edition selector appears above inventory/skills lists
- Switching to 2025 aggregates inventory/skills from 2025-history characters
- Switching back to 2026 restores original aggregation

- [ ] **Step 4: Commit**

```bash
git add public/theview2.html public/app.js
git commit -m "feat: add edition selector to theview2"
```

---

### Task 4: Style the edition selector

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add CSS for `.edition-selector`**

Add styling to `public/style.css` that matches the existing UI aesthetic. The selector should be centered and visually consistent:

```css
.edition-selector {
  display: block;
  margin: 0.5em auto 1em auto;
  padding: 0.4em 0.8em;
  font-size: 1rem;
  border: 1px solid #ccc;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
```

Adjust colors/borders to match what's already in `style.css`.

- [ ] **Step 2: Test all three views**

Verify the selector looks consistent across index.html, theview.html, and theview2.html.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add edition selector styling"
```
