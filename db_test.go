package main

import (
	"database/sql"
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

func TestCreatePlayerActor(t *testing.T) {
	db := setupTestDB(t)

	// Migration: add email column
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	actorID, err := CreatePlayerActor(db, "player@example.com")
	if err != nil {
		t.Fatal(err)
	}

	if actorID <= 0 {
		t.Errorf("expected positive actor ID, got %d", actorID)
	}

	// Verify email stored
	var email sql.NullString
	err = db.QueryRowx("SELECT email FROM actors WHERE id = ?", actorID).Scan(&email)
	if err != nil {
		t.Fatal(err)
	}
	if !email.Valid || email.String != "player@example.com" {
		t.Errorf("email = %v, want player@example.com", email)
	}

	// Verify space is player
	space, err := GetActorSpaceByActorID(db, actorID)
	if err != nil {
		t.Fatal(err)
	}
	if space != ActorSpacePlayer {
		t.Errorf("space = %q, want %q", space, ActorSpacePlayer)
	}
}

func TestFindActorIDByEmail(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	actorID, _ := CreatePlayerActor(db, "find-me@example.com")

	tests := []struct {
		name    string
		email   string
		wantID  int64
		wantErr bool
	}{
		{"existing email", "find-me@example.com", actorID, false},
		{"non-existent email", "nobody@example.com", -1, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, err := FindActorIDByEmail(db, tt.email)
			if (err != nil) != tt.wantErr {
				t.Errorf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && gotID != tt.wantID {
				t.Errorf("got ID %d, want %d", gotID, tt.wantID)
			}
		})
	}
}

func TestSetActorEmail(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	var actorID int64
	db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)

	err := SetActorEmail(db, actorID, "new@example.com")
	if err != nil {
		t.Fatal(err)
	}

	foundID, err := FindActorIDByEmail(db, "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if foundID != actorID {
		t.Errorf("got ID %d, want %d", foundID, actorID)
	}
}
