package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
)

func TestFetchEvents(t *testing.T) {
	db := setupTestDB(t)

	var actorID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
	if err != nil {
		t.Fatal(err)
	}

	// Insert all events in a single batch to guarantee timestamp ordering
	// (separate batches can produce non-monotonic timestamps within the same millisecond)
	results, err := InsertAndCheckEvents(db, -1, actorID, []*proto.Event{
		seedActorEvent("test-player"),
		seedPlayerEvent("test-player", "player:test"),
		playerPersonEvent("player:test", "Jean"),
	})
	if err != nil {
		t.Fatal(err)
	}

	var timestamps []int64
	for _, r := range results {
		if r.Status != EventRecordStatusAccepted {
			t.Fatalf("event not accepted: %+v", r)
		}
		timestamps = append(timestamps, r.Ts)
	}

	// Sanity check
	allEvents, err := FetchEvents(db, actorID, ActorSpacePlayer, -1)
	if err != nil {
		t.Fatal(err)
	}
	if len(allEvents) != 3 {
		t.Fatalf("setup: expected 3 events, got %d", len(allEvents))
	}

	tests := []struct {
		name      string
		from      int64
		wantCount int
	}{
		{"from before all events", -1, 3},
		{"from first event returns rest", timestamps[0], 2},
		{"from second event returns last", timestamps[1], 1},
		{"from last event returns nothing", timestamps[2], 0},
		{"from beyond last event returns nothing", timestamps[2] + 1000, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			events, err := FetchEvents(db, actorID, ActorSpacePlayer, tt.from)
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != tt.wantCount {
				t.Errorf("FetchEvents(from=%d): got %d events, want %d", tt.from, len(events), tt.wantCount)
			}
		})
	}
}

func TestFetchEvents_EmptyProjection(t *testing.T) {
	db := setupTestDB(t)

	var actorID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
	if err != nil {
		t.Fatal(err)
	}

	events, err := FetchEvents(db, actorID, ActorSpacePlayer, -1)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Errorf("expected 0 events for actor with no data, got %d", len(events))
	}
}

func TestInsertAndCheckEvents_Acceptance(t *testing.T) {
	// Each test case uses its own DB and includes all prerequisite events in a single batch
	// to avoid timestamp ordering issues between separate InsertAndCheckEvents calls.
	tests := []struct {
		name           string
		events         []*proto.Event
		checkIndex     int // which event in the batch to check
		wantStatus     EventRecordStatus
	}{
		{
			"valid player person accepted",
			[]*proto.Event{
				seedActorEvent("test-player"),
				seedPlayerEvent("test-player", "player:1"),
				playerPersonEvent("player:1", "Jean"),
			},
			2,
			EventRecordStatusAccepted,
		},
		{
			"duplicate player ID rejected",
			[]*proto.Event{
				seedActorEvent("test-player"),
				seedPlayerEvent("test-player", "player:1"),
				seedPlayerEvent("test-player", "player:1"), // duplicate
			},
			2,
			EventRecordStatusRejected,
		},
		{
			"unauthorized permission rejected",
			[]*proto.Event{
				seedActorEvent("test-player"),
				permissionEvent(1, PermissionOrga), // player cannot grant permissions
			},
			1,
			EventRecordStatusRejected,
		},
		{
			"character for non-existent player rejected",
			[]*proto.Event{
				seedActorEvent("test-player"),
				playerCharacterEvent("player:nonexistent", "char:1"),
			},
			1,
			EventRecordStatusRejected,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupTestDB(t)

			var actorID int64
			err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
			if err != nil {
				t.Fatal(err)
			}

			results, err := InsertAndCheckEvents(db, -1, actorID, tt.events)
			if err != nil {
				t.Fatal(err)
			}

			if len(results) <= tt.checkIndex {
				t.Fatalf("expected at least %d results, got %d", tt.checkIndex+1, len(results))
			}

			got := results[tt.checkIndex]
			if got.Status != tt.wantStatus {
				t.Errorf("event[%d]: got status %v, want %v (error: %s)", tt.checkIndex, got.Status, tt.wantStatus, got.Error)
			}
		})
	}
}
