package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type StateRecord struct {
	ID int64
}

func GetState(db *sqlx.DB, publicKey []byte) (StateRecord, error) {
	var record StateRecord

	err := db.QueryRowx(`
	SELECT states.id 
	FROM states
	JOIN users_states ON users_states.state_id=states.id
	JOIN users ON users.id=users_states.user_id
	WHERE users.public_key=?`,
		publicKey,
	).Scan(&record.ID)

	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return record, fmt.Errorf("query: %w", err)
	}

	if err == nil {
		return record, nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return record, fmt.Errorf("begin: %w", err)
	}

	var userID int64
	err = tx.QueryRowx(`INSERT INTO users (public_key) VALUES (?) RETURNING id`, publicKey).Scan(&userID)
	if err != nil {
		return record, fmt.Errorf("insert user: %w", err)
	}

	err = tx.QueryRowx(`INSERT INTO states DEFAULT VALUES RETURNING id`).Scan(&record.ID)
	if err != nil {
		return record, fmt.Errorf("insert state: %w", err)
	}

	_, err = tx.Exec(`INSERT INTO users_states (state_id, user_id) VALUES (?, ?)`, record.ID, userID)
	if err != nil {
		return record, fmt.Errorf("insert user: %w", err)
	}

	err = tx.Commit()
	if err != nil {
		return record, fmt.Errorf("commit: %w", err)
	}

	return record, nil
}

func InsertEvents[T any](db *sqlx.DB, stateID int64, events []Event[T]) ([]int64, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}

	ids := make([]int64, len(events))

	for i, event := range events {
		data, err := json.Marshal(event)
		if err != nil {
			return nil, fmt.Errorf("marshalling event to JSON: %w", err)
		}

		result, err := tx.Exec(
			"INSERT INTO events (ts, state_id, key, data, status) VALUES (?,?,?,?,0)",
			time.Now().UTC().UnixMilli(),
			stateID,
			event.Key(),
			data,
		)
		if err != nil {
			return nil, fmt.Errorf("exec: %w", err)
		}

		ids[i], err = result.LastInsertId()
		if err != nil {
			return nil, fmt.Errorf("last insert id: %w", err)
		}
	}

	err = tx.Commit()
	if err != nil {
		return nil, fmt.Errorf("tx commit: %w", err)
	}

	return ids, nil
}

type EventRecordStatus uint8

const (
	EventRecordStatusPending  EventRecordStatus = 0
	EventRecordStatusAccepted EventRecordStatus = 1
)

type EventRecord struct {
	ID        int64
	Timestamp uint
	Key       string
	Data      []byte
	Status    EventRecordStatus
}

func GetEvents(db *sqlx.DB, stateID int64) ([]EventRecord, error) {
	var events []EventRecord

	result, err := db.Queryx("SELECT ROWID, ts, key, data, status FROM events WHERE state_id=? AND status != 2 ORDER BY ROWID ASC", stateID)
	if err != nil {
		return events, fmt.Errorf("query: %w", err)
	}

	for result.Next() {
		var event EventRecord

		err = result.Rows.Scan(
			&event.ID,
			&event.Timestamp,
			&event.Key,
			&event.Data,
			&event.Status,
		)
		if err != nil {
			return events, fmt.Errorf("scan: %w", err)
		}

		events = append(events, event)
	}

	return events, nil
}
