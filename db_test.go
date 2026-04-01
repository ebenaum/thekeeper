package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
)

func TestUseAuthKey(t *testing.T) {
	db := setupTestDB(t)

	var actorID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
	if err != nil {
		t.Fatal(err)
	}

	key, err := InsertAuthKey(db, actorID)
	if err != nil {
		t.Fatal(err)
	}

	// Tests run sequentially: first redeems the key, second attempts re-redemption
	tests := []struct {
		name    string
		key     string
		wantErr bool
	}{
		{"valid key succeeds", key, false},
		// BUG: UseAuthKey lacks a redeemed_at IS NULL check, so this currently succeeds
		{"already redeemed key fails", key, true},
		{"non-existent key fails", "nonexistent-key", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotActorID, err := UseAuthKey(db, tt.key)
			if (err != nil) != tt.wantErr {
				t.Errorf("UseAuthKey(%q) error = %v, wantErr %v", tt.key, err, tt.wantErr)
			}
			if !tt.wantErr && gotActorID != actorID {
				t.Errorf("got actorID %d, want %d", gotActorID, actorID)
			}
		})
	}
}

func TestInsertAuthKey(t *testing.T) {
	db := setupTestDB(t)

	var actorID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
	if err != nil {
		t.Fatal(err)
	}

	key, err := InsertAuthKey(db, actorID)
	if err != nil {
		t.Fatal(err)
	}

	if key == "" {
		t.Error("InsertAuthKey returned empty key")
	}

	// Verify key exists in DB
	var count int
	err = db.QueryRowx("SELECT COUNT(*) FROM auth_keys WHERE key = ?", key).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("expected 1 auth_key row, got %d", count)
	}
}

func TestFindActorIDByHandle(t *testing.T) {
	db := setupTestDB(t)

	var actorID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)
	if err != nil {
		t.Fatal(err)
	}

	results, err := InsertAndCheckEvents(db, -1, actorID, []*proto.Event{
		seedActorEvent("test-handle"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Status != EventRecordStatusAccepted {
		t.Fatalf("seed actor not accepted: %+v", results[0])
	}

	tests := []struct {
		name    string
		handle  string
		wantID  int64
		wantErr bool
	}{
		{"existing handle", "test-handle", actorID, false},
		{"non-existent handle", "nonexistent", -1, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, err := FindActorIDByHandle(db, tt.handle)
			if (err != nil) != tt.wantErr {
				t.Errorf("FindActorIDByHandle(%q) error = %v, wantErr %v", tt.handle, err, tt.wantErr)
			}
			if !tt.wantErr && gotID != tt.wantID {
				t.Errorf("got ID %d, want %d", gotID, tt.wantID)
			}
		})
	}
}
