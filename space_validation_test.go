package main

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/google/go-cmp/cmp"
)

func TestSeedActor(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		handle        string
		wantErr       bool
	}{
		{"valid new handle", 10, "new-handle", false},
		{"empty handle rejected", 10, "", true},
		{"duplicate handle rejected", 10, "player-handle", true},
		{"actor already has handle", 2, "another-handle", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, seedActorEvent(tt.handle))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestPermission(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		targetActorID int64
		permission    string
		wantErr       bool
	}{
		{"root grants orga", 0, 10, PermissionOrga, false},
		{"orga cannot grant", 1, 10, PermissionOrga, true},
		{"player cannot grant", 2, 10, PermissionOrga, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, permissionEvent(tt.targetActorID, tt.permission))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSeedPlayer(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		handle        string
		playerID      string
		wantErr       bool
	}{
		{"own handle accepted", 2, "player-handle", "player:new", false},
		{"orga rejected", 1, "player-handle", "player:new", true},
		{"non-existent handle", 2, "nonexistent", "player:new", true},
		{"wrong actor for handle", 3, "player-handle", "player:new", true},
		{"duplicate player ID", 2, "player-handle", "player:1", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, seedPlayerEvent(tt.handle, tt.playerID))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestPlayerPerson(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		playerID      string
		wantErr       bool
	}{
		{"owner modifies own", 2, "player:1", false},
		{"orga modifies any", 1, "player:1", false},
		{"other player rejected", 3, "player:1", true},
		{"non-existent player", 2, "player:nonexistent", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, playerPersonEvent(tt.playerID, "Test"))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestPlayerCharacter(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		playerID      string
		characterID   string
		wantErr       bool
	}{
		{"owner creates new character", 2, "player:1", "char:new", false},
		{"owner updates own character", 2, "player:1", "char:1", false},
		{"orga creates for player", 1, "player:1", "char:new", false},
		{"other player rejected", 3, "player:1", "char:new", true},
		{"non-existent player", 2, "player:nonexistent", "char:new", true},
		{"character belongs to other player", 2, "player:1", "char:2", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, playerCharacterEvent(tt.playerID, tt.characterID))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestPlayerCharacterOrgaEdit(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		characterID   string
		wantErr       bool
	}{
		{"orga edits character", 1, "char:1", false},
		{"player rejected", 2, "char:1", true},
		{"non-existent character", 1, "char:nonexistent", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, orgaEditEvent(tt.characterID))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDeleteCharacter(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		characterID   string
		wantErr       bool
	}{
		{"root deletes", 0, "char:1", false},
		{"orga rejected", 1, "char:1", true},
		{"player rejected", 2, "char:1", true},
		{"non-existent character", 0, "char:nonexistent", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, deleteCharacterEvent(tt.characterID))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDeletePlayer(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		playerID      string
		wantErr       bool
	}{
		{"root deletes", 0, "player:1", false},
		{"orga rejected", 1, "player:1", true},
		{"player rejected", 2, "player:1", true},
		{"non-existent player", 0, "player:nonexistent", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, deletePlayerEvent(tt.playerID))
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDeletePlayer_CascadesCharacters(t *testing.T) {
	s := baseValidationState(t)

	if err := s.Process(0, deletePlayerEvent("player:1")); err != nil {
		t.Fatal(err)
	}

	if _, exists := s.PlayersIDs["player:1"]; exists {
		t.Error("player:1 should have been removed")
	}
	if _, exists := s.CharacterIDs["char:1"]; exists {
		t.Error("char:1 should have been cascaded with player:1")
	}
	if _, exists := s.PlayersIDs["player:2"]; !exists {
		t.Error("player:2 should still exist")
	}
	if _, exists := s.CharacterIDs["char:2"]; !exists {
		t.Error("char:2 should still exist")
	}
}

func TestReset(t *testing.T) {
	tests := []struct {
		name          string
		sourceActorID int64
		wantErr       bool
	}{
		{"root resets", 0, false},
		{"orga rejected", 1, true},
		{"player rejected", 2, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := baseValidationState(t)
			err := s.Process(tt.sourceActorID, resetEvent())
			if (err != nil) != tt.wantErr {
				t.Errorf("Process() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGobEncodeDecode(t *testing.T) {
	space := SpaceValidation{
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
		PlayersIDs: map[string]struct{ ActorID int64 }{},
	}

	type step struct {
		sourceActorID int64
		event         *proto.Event
	}

	steps := []step{
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "benoit",
				},
			}},
		},
		{
			0,
			&proto.Event{Msg: &proto.Event_Permission{
				Permission: &proto.EventPermission{
					ActorId:    1,
					Permission: PermissionOrga,
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "art-coffee",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "tea-grumpy",
				},
			}},
		},
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "art-coffee",
					PlayerId: "player:coffee-art",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "tea-grumpy",
					PlayerId: "player:grumpy-tea",
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_PlayerPerson{
				PlayerPerson: &proto.EventPlayerPerson{
					PlayerId: "player:coffee-art",
					Surname:  "Jean",
				},
			}},
		},
	}

	for i, step := range steps {
		err := space.Process(step.sourceActorID, step.event)

		if err != nil {
			t.Logf("#%d: %v\n", i, err)
		} else {
			t.Logf("#%d: OK\n", i)
		}
	}

	var store bytes.Buffer

	encoder := gob.NewEncoder(&store)
	decoder := gob.NewDecoder(&store)

	err := encoder.Encode(space)
	if err != nil {
		t.Fatal(err)
	}

	var cpy SpaceValidation

	t.Log(store.Len())

	err = decoder.Decode(&cpy)
	if err != nil {
		t.Fatal(err)
	}

	t.Log(cpy)
	t.Log(space)
	t.Log(cmp.Diff(cpy, space))
}
