package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
)

func TestSpacePlayer_Filtering(t *testing.T) {
	type eventStep struct {
		sourceActorID int64
		event         *proto.Event
	}

	allEvents := []eventStep{
		{1, seedActorEvent("orga-handle")},
		{2, seedActorEvent("player-a")},
		{3, seedActorEvent("player-b")},
		{0, permissionEvent(1, PermissionOrga)},
		{2, seedPlayerEvent("player-a", "player:a")},
		{3, seedPlayerEvent("player-b", "player:b")},
		{2, playerPersonEvent("player:a", "Alice")},
		{3, playerPersonEvent("player:b", "Bob")},
		{2, playerCharacterEvent("player:a", "char:a")},
		{3, playerCharacterEvent("player:b", "char:b")},
		{1, orgaEditEvent("char:a")},
	}

	tests := []struct {
		name      string
		actorID   int64
		wantCount int
	}{
		// SeedActor + SeedPlayer + PlayerPerson + PlayerCharacter + OrgaEdit(char:a)
		{"player-a sees own events and orga edit", 2, 5},
		// SeedActor + SeedPlayer + PlayerPerson + PlayerCharacter
		{"player-b sees own events only", 3, 4},
		{"unknown actor sees nothing", 99, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sp := NewSpacePlayer(tt.actorID)
			for _, e := range allEvents {
				if err := sp.Process(e.sourceActorID, e.event); err != nil {
					t.Fatalf("Process: %v", err)
				}
			}
			got := sp.GetEvents()
			if len(got) != tt.wantCount {
				t.Errorf("got %d events, want %d", len(got), tt.wantCount)
			}
		})
	}
}

func TestSpacePlayer_EventTracking(t *testing.T) {
	type eventStep struct {
		sourceActorID int64
		event         *proto.Event
	}

	tests := []struct {
		name      string
		actorID   int64
		events    []eventStep
		wantCount int
	}{
		{
			"delete character stops tracking orga edits",
			2,
			[]eventStep{
				{2, seedActorEvent("player-a")},
				{2, seedPlayerEvent("player-a", "player:a")},
				{2, playerCharacterEvent("player:a", "char:a")},
				{0, deleteCharacterEvent("char:a")},
				{1, orgaEditEvent("char:a")}, // excluded: char:a deleted
			},
			// SeedActor + SeedPlayer + PlayerCharacter + DeleteCharacter
			4,
		},
		{
			"delete player cascades character tracking",
			2,
			[]eventStep{
				{2, seedActorEvent("player-a")},
				{2, seedPlayerEvent("player-a", "player:a")},
				{2, playerCharacterEvent("player:a", "char:a")},
				{0, deletePlayerEvent("player:a")},
				{2, playerPersonEvent("player:a", "Alice")}, // excluded: player deleted
				{1, orgaEditEvent("char:a")},                // excluded: cascaded with player
			},
			// SeedActor + SeedPlayer + PlayerCharacter + DeletePlayer
			4,
		},
		{
			"reset event is visible to player",
			2,
			[]eventStep{
				{2, seedActorEvent("player-a")},
				{0, resetEvent()},
			},
			2,
		},
		{
			"permission events excluded from player view",
			2,
			[]eventStep{
				{2, seedActorEvent("player-a")},
				{0, permissionEvent(1, PermissionOrga)},
			},
			// only SeedActor, Permission is excluded
			1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sp := NewSpacePlayer(tt.actorID)
			for _, e := range tt.events {
				if err := sp.Process(e.sourceActorID, e.event); err != nil {
					t.Fatalf("Process: %v", err)
				}
			}
			got := sp.GetEvents()
			if len(got) != tt.wantCount {
				t.Errorf("got %d events, want %d", len(got), tt.wantCount)
			}
		})
	}
}

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
