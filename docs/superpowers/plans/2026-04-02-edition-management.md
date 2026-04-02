# Edition Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edition tagging to characters so organizers only see 2026 characters, while players see all their characters across editions.

**Architecture:** A new `ActivateCharacter` protobuf event type carries a `character_id` and `edition` string. The backend validates edition values against an allowlist (`2025`, `2026`, `optout`). Both projections pass `ActivateCharacter` events through to the frontend. Edition filtering (showing only 2026 characters in orga views) is handled entirely on the frontend side in `app.js`.

**Tech Stack:** Go, Protocol Buffers (protoc + protoc-gen-go + protoc-gen-es), SQLite, vanilla JavaScript

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `proto/activate_character.proto` | New protobuf message definition |
| Modify | `proto/event.proto` | Add `ActivateCharacter` to the `Event` oneof |
| Regenerate | `proto/*.pb.go`, `public/*_pb.js` | Generated code from `proto/gen.sh` |
| Modify | `space_validation.go` | Validate `ActivateCharacter` events (edition allowlist, character exists, player owns it) |
| Modify | `space_validation.go` | Track edition status per character in `SpaceValidation` |
| Modify | `space_validation.go` | Pass `ActivateCharacter` events through in `SpaceOrga` and `SpacePlayer` |
| Modify | `space_validation_test.go` | Tests for validation logic |
| Modify | `projection_test.go` | Tests for projection filtering |
| Modify | `testhelpers_test.go` | Add `activateCharacterEvent` helper |
| Modify | `main.go` | Add `migrate-editions` CLI command |
| Modify | `public/app.js` | Process `ActivateCharacter` in `processEvent`, auto-emit on character creation, enroll/opt-out UI |
| Modify | `public/index.html` | Add edition badge and enroll/opt-out button to character template |

---

### Task 1: Protobuf Definition

**Files:**
- Create: `proto/activate_character.proto`
- Modify: `proto/event.proto`

- [ ] **Step 1: Create the new proto file**

Create `proto/activate_character.proto`:

```protobuf
syntax = "proto3";
package thekeeper;

option go_package = "github.com/ebenaum/thekeeper/proto;proto";

message EventActivateCharacter {
   string characterId = 1;
   string edition = 2;
}
```

- [ ] **Step 2: Add ActivateCharacter to the Event oneof**

In `proto/event.proto`, add the import and new oneof field:

```protobuf
import "activate_character.proto";
```

Add inside the `oneof msg` block:

```protobuf
    EventActivateCharacter         ActivateCharacter         = 11;
```

- [ ] **Step 3: Regenerate protobuf bindings**

Run:
```bash
cd proto && bash gen.sh
```

Expected: new files `proto/activate_character.pb.go` and `public/activate_character_pb.js` generated, existing `proto/event.pb.go` and `public/event_pb.js` updated.

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
go build ./...
```

Expected: clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add proto/activate_character.proto proto/event.proto proto/*.pb.go public/*_pb.js
git commit -m "feat: add ActivateCharacter protobuf event type"
```

---

### Task 2: Test Helper

**Files:**
- Modify: `testhelpers_test.go`

- [ ] **Step 1: Add the activateCharacterEvent helper**

Add to `testhelpers_test.go`:

```go
func activateCharacterEvent(characterID, edition string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_ActivateCharacter{ActivateCharacter: &proto.EventActivateCharacter{CharacterId: characterID, Edition: edition}}}
}
```

- [ ] **Step 2: Verify tests still pass**

Run:
```bash
go test ./...
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add testhelpers_test.go
git commit -m "test: add activateCharacterEvent test helper"
```

---

### Task 3: SpaceValidation — Validation Logic

**Files:**
- Modify: `space_validation.go`
- Modify: `space_validation_test.go`

- [ ] **Step 1: Write failing tests for ActivateCharacter validation**

Add to `space_validation_test.go`:

```go
func TestActivateCharacter(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		characterID   string
		edition       string
		wantErr       bool
	}{
		{"owner activates own character for 2025", 2, "char:1", "2025", false},
		{"owner activates own character for 2026", 2, "char:1", "2026", false},
		{"owner opts out own character", 2, "char:1", "optout", false},
		{"invalid edition rejected", 2, "char:1", "2027", true},
		{"empty edition rejected", 2, "char:1", "", true},
		{"other player rejected", 3, "char:1", "2026", true},
		{"orga can activate any character", 1, "char:1", "2026", false},
		{"non-existent character rejected", 2, "char:nonexistent", "2026", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, activateCharacterEvent(tt.characterID, tt.edition))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./... -run TestActivateCharacter -v
```

Expected: FAIL — `event ... not handled` from the default case in `Process`.

- [ ] **Step 3: Add the allowed editions set and CharacterEditions tracking**

In `space_validation.go`, add the allowed editions variable near the top (after the existing `Permission` type constants):

```go
var allowedEditions = map[string]bool{
	"2025":   true,
	"2026":   true,
	"optout": true,
}
```

Add `CharacterEditions` field to the `SpaceValidation` struct:

```go
type SpaceValidation struct {
	Handles    Handles
	Permission Permission
	PlayersIDs map[string]struct {
		ActorID int64
	}
	CharacterIDs map[string]struct {
		PlayerID string
	}
	CharacterEditions map[string]string
}
```

Update `NewSpaceValidation` to initialize it:

```go
func NewSpaceValidation() SpaceValidation {
	return SpaceValidation{
		Handles: Handles{
			HandleToID: map[string]int64{},
			IDToHandle: map[int64]string{
				0: "",
			},
		},
		Permission: Permission{
			Actors: map[int64]string{
				0: PermissionRoot,
			},
		},
		PlayersIDs:        map[string]struct{ ActorID int64 }{},
		CharacterIDs:      map[string]struct{ PlayerID string }{},
		CharacterEditions: map[string]string{},
	}
}
```

- [ ] **Step 4: Add the ActivateCharacter case to SpaceValidation.Process**

Add a new case in the `Process` switch, before the `default`:

```go
	case *proto.Event_ActivateCharacter:
		if !allowedEditions[v.ActivateCharacter.Edition] {
			return fmt.Errorf("invalid edition %q", v.ActivateCharacter.Edition)
		}

		character, exists := s.CharacterIDs[v.ActivateCharacter.CharacterId]
		if !exists {
			return fmt.Errorf("character does not exist")
		}

		player, exists := s.PlayersIDs[character.PlayerID]
		if !exists {
			return fmt.Errorf("player does not exist")
		}

		if sourceActorID != player.ActorID && s.Permission.Actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		s.CharacterEditions[v.ActivateCharacter.CharacterId] = v.ActivateCharacter.Edition

		return nil
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
go test ./... -run TestActivateCharacter -v
```

Expected: all 8 cases PASS.

- [ ] **Step 6: Run full test suite**

Run:
```bash
go test ./...
```

Expected: all tests pass (the new `CharacterEditions` field does not break `TestGobEncodeDecode` — gob encodes exported fields and `map[string]string` is supported).

- [ ] **Step 7: Commit**

```bash
git add space_validation.go space_validation_test.go
git commit -m "feat: validate ActivateCharacter events with edition allowlist"
```

---

### Task 4: SpaceOrga — Pass Through ActivateCharacter

**Files:**
- Modify: `space_validation.go` (`SpaceOrga`)
- Modify: `projection_test.go`

The orga projection stays simple — just pass all events through, including `ActivateCharacter`. Edition filtering happens entirely on the frontend side.

- [ ] **Step 1: Add ActivateCharacter to SpaceOrga.Process**

In `space_validation.go`, in `SpaceOrga.Process`, add `*proto.Event_ActivateCharacter` to the existing catch-all case:

```go
	case *proto.Event_SeedPlayer, *proto.Event_PlayerPerson,
		*proto.Event_PlayerCharacter, *proto.Event_SeedActor,
		*proto.Event_Permission, *proto.Event_Reset_,
		*proto.Event_DeleteCharacter, *proto.Event_DeletePlayer,
		*proto.Event_PlayerCharacterOrgaEdit, *proto.Event_ActivateCharacter:
		s.Events = append(s.Events, event)

		return nil
```

- [ ] **Step 2: Update TestSpaceOrga_SeesAllEvents to include ActivateCharacter**

In `projection_test.go`, add an `ActivateCharacter` event to the test:

```go
func TestSpaceOrga_SeesAllEvents(t *testing.T) {
	type eventStep struct {
		sourceActorID int64
		event         *proto.Event
	}

	allEvents := []eventStep{
		{1, seedActorEvent("orga-handle")},
		{2, seedActorEvent("player-a")},
		{0, permissionEvent(1, PermissionOrga)},
		{2, seedPlayerEvent("player-a", "player:a")},
		{2, playerPersonEvent("player:a", "Alice")},
		{2, playerCharacterEvent("player:a", "char:a")},
		{2, activateCharacterEvent("char:a", "2026")},
		{1, orgaEditEvent("char:a")},
		{0, deleteCharacterEvent("char:a")},
		{0, resetEvent()},
	}

	sp := NewSpaceOrga(1)
	for _, e := range allEvents {
		if err := sp.Process(e.sourceActorID, e.event); err != nil {
			t.Fatalf("Process: %v", err)
		}
	}

	got := sp.GetEvents()
	if len(got) != len(allEvents) {
		t.Errorf("orga should see all %d events, got %d", len(allEvents), len(got))
	}
}
```

- [ ] **Step 3: Run full test suite**

Run:
```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add space_validation.go projection_test.go
git commit -m "feat: pass ActivateCharacter events through orga projection"
```

---

### Task 5: Player Projection — Pass Through ActivateCharacter

**Files:**
- Modify: `space_validation.go` (`SpacePlayer`)
- Modify: `projection_test.go`

- [ ] **Step 1: Write failing test for player projection**

Add to `projection_test.go`:

```go
func TestSpacePlayer_SeesActivateCharacterEvents(t *testing.T) {
	type eventStep struct {
		sourceActorID int64
		event         *proto.Event
	}

	events := []eventStep{
		{2, seedActorEvent("player-a")},
		{2, seedPlayerEvent("player-a", "player:a")},
		{2, playerCharacterEvent("player:a", "char:a")},
		{2, activateCharacterEvent("char:a", "2025")},
		{2, activateCharacterEvent("char:a", "2026")},
	}

	sp := NewSpacePlayer(2)
	for _, e := range events {
		if err := sp.Process(e.sourceActorID, e.event); err != nil {
			t.Fatalf("Process: %v", err)
		}
	}

	got := sp.GetEvents()
	// SeedActor + SeedPlayer + PlayerCharacter + 2 ActivateCharacter = 5
	if len(got) != 5 {
		t.Errorf("got %d events, want 5", len(got))
	}
}

func TestSpacePlayer_DoesNotSeeOtherPlayersActivateCharacter(t *testing.T) {
	type eventStep struct {
		sourceActorID int64
		event         *proto.Event
	}

	events := []eventStep{
		{2, seedActorEvent("player-a")},
		{3, seedActorEvent("player-b")},
		{2, seedPlayerEvent("player-a", "player:a")},
		{3, seedPlayerEvent("player-b", "player:b")},
		{2, playerCharacterEvent("player:a", "char:a")},
		{3, playerCharacterEvent("player:b", "char:b")},
		{2, activateCharacterEvent("char:a", "2026")},
		{3, activateCharacterEvent("char:b", "2026")},
	}

	sp := NewSpacePlayer(2)
	for _, e := range events {
		if err := sp.Process(e.sourceActorID, e.event); err != nil {
			t.Fatalf("Process: %v", err)
		}
	}

	got := sp.GetEvents()
	// SeedActor + SeedPlayer + PlayerCharacter + ActivateCharacter (char:a only) = 4
	if len(got) != 4 {
		t.Errorf("got %d events, want 4", len(got))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./... -run "TestSpacePlayer_SeesActivateCharacter|TestSpacePlayer_DoesNotSeeOtherPlayers" -v
```

Expected: FAIL — `event ... not handled`.

- [ ] **Step 3: Add ActivateCharacter case to SpacePlayer.Process**

Add a new case in `SpacePlayer.Process`, before the `default`:

```go
	case *proto.Event_ActivateCharacter:
		if _, exists := s.CharacterIDs[v.ActivateCharacter.CharacterId]; exists {
			s.Events = append(s.Events, event)
		}

		return nil
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
go test ./... -run "TestSpacePlayer_SeesActivateCharacter|TestSpacePlayer_DoesNotSeeOtherPlayers" -v
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run:
```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add space_validation.go projection_test.go
git commit -m "feat: player projection passes through ActivateCharacter events"
```

---

### Task 6: Migration CLI Command

**Files:**
- Modify: `main.go`
- Modify: `state_test.go`

- [ ] **Step 1: Write a test for the migration logic**

The migration replays events, finds all characters, and inserts `ActivateCharacter:2025` for each. We test the core logic through `Run` — after inserting migration events, all characters should have accepted `ActivateCharacter` events.

Add to `state_test.go`:

```go
func TestMigrateEditions(t *testing.T) {
	db := setupTestDB(t)

	actorID := createPlayerActor(t, db, "test@example.com")

	// Seed the actor and create a player + character
	seedEvents := []*proto.Event{
		seedActorEvent("test-handle"),
	}
	results, err := InsertAndCheckEvents(db, -1, actorID, seedEvents)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Status != EventRecordStatusAccepted {
		t.Fatalf("seed actor not accepted: %v", results[0])
	}

	playerEvents := []*proto.Event{
		seedPlayerEvent("test-handle", "player:test"),
	}
	results, err = InsertAndCheckEvents(db, -1, actorID, playerEvents)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Status != EventRecordStatusAccepted {
		t.Fatalf("seed player not accepted: %v", results[0])
	}

	charEvents := []*proto.Event{
		playerCharacterEvent("player:test", "char:test"),
	}
	results, err = InsertAndCheckEvents(db, -1, actorID, charEvents)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Status != EventRecordStatusAccepted {
		t.Fatalf("player character not accepted: %v", results[0])
	}

	// Run migration
	err = migrateEditions(db)
	if err != nil {
		t.Fatal(err)
	}

	// Verify: replay all events and check char:test has edition 2025
	sv := NewSpaceValidation()
	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		sv.Process(record.SourceActorID, &record.Event)
	}

	if sv.CharacterEditions["char:test"] != "2025" {
		t.Errorf("expected edition 2025, got %q", sv.CharacterEditions["char:test"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
go test ./... -run TestMigrateEditions -v
```

Expected: FAIL — `migrateEditions` is undefined.

- [ ] **Step 3: Implement migrateEditions function**

Add to `main.go`:

```go
func migrateEditions(db *sqlx.DB) error {
	sv := NewSpaceValidation()

	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		return fmt.Errorf("get events: %w", err)
	}

	for _, record := range records {
		sv.Process(record.SourceActorID, &record.Event)
	}

	var migrated int
	for characterID := range sv.CharacterIDs {
		if sv.CharacterEditions[characterID] != "" {
			continue
		}

		result, err := InsertAndCheckEvents(db, -1, 0, []*proto.Event{
			{
				Msg: &proto.Event_ActivateCharacter{
					ActivateCharacter: &proto.EventActivateCharacter{
						CharacterId: characterID,
						Edition:     "2025",
					},
				},
			},
		})
		if err != nil {
			return fmt.Errorf("activate character %s: %w", characterID, err)
		}
		if result[0].Status != EventRecordStatusAccepted {
			return fmt.Errorf("activate character %s was not accepted: %v", characterID, result[0])
		}
		migrated++
	}

	fmt.Printf("Migrated %d characters to edition 2025\n", migrated)
	return nil
}
```

- [ ] **Step 4: Add the CLI command to the switch in main()**

Add to the `switch os.Args[1]` block in `main.go`:

```go
	case "migrate-editions":
		err = migrateEditions(db)
```

Update the `usage()` function to include `migrate-editions`:

```go
func usage() string {
	return "./cmd http <db-path>|https <db-path> <certfile> <keyfile>|create-orga <db-path> <handle> <email>|link-orga <db-path> <handle>|delete-player <db-path> <player id>|delete-character <db-path> <character id>|invite <db-path> <email>|migrate-emails <db-path>|list-actors <db-path>|migrate-editions <db-path>"
}
```

- [ ] **Step 5: Run the migration test**

Run:
```bash
go test ./... -run TestMigrateEditions -v
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run:
```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add main.go state_test.go
git commit -m "feat: add migrate-editions CLI command to tag existing characters as 2025"
```

---

### Task 7: Frontend — Process ActivateCharacter Events

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add the import for the new protobuf schema**

At the top of `public/app.js`, add the import alongside the existing ones:

```javascript
import { EventActivateCharacterSchema } from "./activate_character_pb.js";
```

- [ ] **Step 2: Add edition tracking to the Data type and processEvent**

Update the `CharacterForm` JSDoc typedef to include edition:

In the `@typedef {Object} CharacterForm` block, add:
```javascript
 * @property {string}                 [edition]
```

Add a new case in `processEvent` (inside the `switch (eventType)` block, before the `default`):

```javascript
    case "ActivateCharacter":
      if (data.characters[eventValue.characterId]) {
        data.characters[eventValue.characterId].edition = eventValue.edition;
      }

      break;
```

- [ ] **Step 3: Auto-emit ActivateCharacter on new character creation**

In the `submitForm` function inside `personnage()` (around line 2081, after the `PlayerCharacter` event push and before the orga edit check), add:

```javascript
    events.push({
      msg: {
        case: "ActivateCharacter",
        value: {
          characterId: characterId,
          edition: "2026",
        },
      },
    });
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: frontend processes ActivateCharacter events and auto-emits on character creation"
```

---

### Task 8: Frontend — Edition UI in Player Index

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Add edition badge and action button to the character template**

In `public/index.html`, update the `template__character` template to include edition elements:

```html
    <template id="template__character">
      <li class="index__player__characters__character">
        <span class="index__player__characters__character__name"></span> |
        <span class="index__player__characters__character__peek"></span> -
        <a class="index__player__characters__character__link a-underline d-none"
          >Voir / Éditer</a
        >
        <a
          class="index__player__characters__character__final__link a-underline d-none"
          target="_blank"
          >Fiche finale</a
        >
        <span class="d-none character-reviewed-badge">Revue par orga</span>
        <span class="character-edition-badge"></span>
        <button class="character-edition-action a-underline d-none"></button>
      </li>
    </template>
```

- [ ] **Step 2: Add edition display and action logic in the index() function**

In `public/app.js`, inside the `index()` function, find the block where character template clones are populated (the `player.characters.forEach` loop, around line 2678). After the existing badge/link logic (around line 2748, before `charactersElement.prepend(characterClone)`), add:

```javascript
        const editionBadgeElement = /** @type {HTMLElement} */ (
          characterClone.querySelector(".character-edition-badge")
        );
        const editionActionElement = /** @type {HTMLButtonElement} */ (
          characterClone.querySelector(".character-edition-action")
        );

        const edition = character.edition || "2025";
        editionBadgeElement.textContent = edition === "optout" ? "Opt-out" : edition;

        if (state.data.permission !== "orga") {
          if (edition === "2026") {
            editionActionElement.textContent = "Retirer";
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
```

- [ ] **Step 3: Filter orga views to only show 2026 characters**

In `public/app.js`, in the `theview()` function (the orga table view), find the loop `Object.keys(state.data.players).forEach((playerId) => {` (around line 2307). Replace the characters variable:

```javascript
    const characters = player.characters
      .filter((cid) => state.data.characters[cid]?.edition === "2026");

    if (characters.length === 0) {
      return;
    }
```

This replaces the existing line:
```javascript
    const characters =
      player.characters.length === 0 ? ["empty"] : player.characters;
```

In the `index()` function (the player/orga card view), the filtering is different: for orgas, skip characters not in 2026 and skip players with no 2026 characters. Find the `player.characters.forEach` loop inside the `Object.keys(state.data.players).forEach` block (around line 2678). Wrap it with edition filtering for orgas:

```javascript
      const visibleCharacters = state.data.permission === "orga"
        ? player.characters.filter((cid) => state.data.characters[cid]?.edition === "2026")
        : player.characters;

      if (state.data.permission === "orga" && visibleCharacters.length === 0) {
        return;
      }
```

Then replace `player.characters.forEach` with `visibleCharacters.forEach` in the loop that follows.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: edition badge, enroll/opt-out buttons, filter orga views to 2026 only"
```

---

### Task 9: Cleanup of DeleteCharacter in SpaceValidation

**Files:**
- Modify: `space_validation.go`
- Modify: `space_validation_test.go`

- [ ] **Step 1: Write a test for edition cleanup on character deletion**

Add to `space_validation_test.go`:

```go
func TestDeleteCharacter_CleansUpEdition(t *testing.T) {
	s := baseValidationState(t)

	// Activate char:1 for 2026
	if err := s.Process(2, activateCharacterEvent("char:1", "2026")); err != nil {
		t.Fatal(err)
	}
	if s.CharacterEditions["char:1"] != "2026" {
		t.Fatal("expected char:1 to have edition 2026")
	}

	// Delete char:1
	if err := s.Process(0, deleteCharacterEvent("char:1")); err != nil {
		t.Fatal(err)
	}

	if _, exists := s.CharacterEditions["char:1"]; exists {
		t.Error("char:1 edition should have been cleaned up on delete")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
go test ./... -run TestDeleteCharacter_CleansUpEdition -v
```

Expected: FAIL — delete does not clean up `CharacterEditions`.

- [ ] **Step 3: Add cleanup to DeleteCharacter case**

In `space_validation.go`, in the `Event_DeleteCharacter` case of `SpaceValidation.Process`, add after `delete(s.CharacterIDs, v.DeleteCharacter.CharacterId)`:

```go
		delete(s.CharacterEditions, v.DeleteCharacter.CharacterId)
```

- [ ] **Step 4: Also clean up editions in DeletePlayer cascade**

In the `Event_DeletePlayer` case, inside the loop `for characterID, character := range s.CharacterIDs`, add after `delete(s.CharacterIDs, characterID)`:

```go
				delete(s.CharacterEditions, characterID)
```

- [ ] **Step 5: Run tests**

Run:
```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add space_validation.go space_validation_test.go
git commit -m "fix: clean up CharacterEditions on character/player deletion"
```
