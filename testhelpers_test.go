package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

func seedActorEvent(handle string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_SeedActor{SeedActor: &proto.EventSeedActor{Handle: handle}}}
}

func permissionEvent(actorID int64, perm string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_Permission{Permission: &proto.EventPermission{ActorId: actorID, Permission: perm}}}
}

func seedPlayerEvent(handle, playerID string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_SeedPlayer{SeedPlayer: &proto.EventSeedPlayer{Handle: handle, PlayerId: playerID}}}
}

func playerPersonEvent(playerID, surname string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_PlayerPerson{PlayerPerson: &proto.EventPlayerPerson{PlayerId: playerID, Surname: surname}}}
}

func playerCharacterEvent(playerID, characterID string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_PlayerCharacter{PlayerCharacter: &proto.EventPlayerCharacter{PlayerId: playerID, CharacterId: characterID}}}
}

func orgaEditEvent(characterID string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_PlayerCharacterOrgaEdit{PlayerCharacterOrgaEdit: &proto.EventPlayerCharacterOrgaEdit{CharacterId: characterID}}}
}

func deletePlayerEvent(playerID string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_DeletePlayer{DeletePlayer: &proto.EventDeletePlayer{PlayerId: playerID}}}
}

func deleteCharacterEvent(characterID string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_DeleteCharacter{DeleteCharacter: &proto.EventDeleteCharacter{CharacterId: characterID}}}
}

func resetEvent() *proto.Event {
	return &proto.Event{Msg: &proto.Event_Reset_{}}
}

func activateCharacterEvent(characterID, edition string) *proto.Event {
	return &proto.Event{Msg: &proto.Event_ActivateCharacter{ActivateCharacter: &proto.EventActivateCharacter{CharacterId: characterID, Edition: edition}}}
}

// baseValidationState returns a SpaceValidation with:
//   - Actor 0: root (implicit)
//   - Actor 1: handle "orga-handle", permission=orga
//   - Actor 2: handle "player-handle", player "player:1", character "char:1"
//   - Actor 3: handle "other-player", player "player:2", character "char:2"
func baseValidationState(t *testing.T) SpaceValidation {
	t.Helper()
	sv := NewSpaceValidation()

	setup := []struct {
		actorID int64
		event   *proto.Event
	}{
		{1, seedActorEvent("orga-handle")},
		{0, permissionEvent(1, PermissionOrga)},
		{2, seedActorEvent("player-handle")},
		{3, seedActorEvent("other-player")},
		{2, seedPlayerEvent("player-handle", "player:1")},
		{3, seedPlayerEvent("other-player", "player:2")},
		{2, playerCharacterEvent("player:1", "char:1")},
		{3, playerCharacterEvent("player:2", "char:2")},
	}

	for i, step := range setup {
		if err := sv.Process(step.actorID, step.event); err != nil {
			t.Fatalf("baseValidationState step %d: %v", i, err)
		}
	}

	return sv
}

func createPlayerActor(t *testing.T, db *sqlx.DB, email string) int64 {
	t.Helper()
	var id int64
	err := db.QueryRowx(
		`INSERT INTO actors (space, email) VALUES (?, ?) RETURNING id`,
		ActorSpacePlayer,
		email,
	).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func setupTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	db, err := sqlx.Open("sqlite3", ":memory:?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(schema)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
