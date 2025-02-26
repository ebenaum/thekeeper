package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"math/rand"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
	protolib "google.golang.org/protobuf/proto"
)

type EventRecordStatus uint64

const (
	EventRecordStatusPending EventRecordStatus = 1 << iota
	EventRecordStatusAccepted
	EventRecordStatusRejected
	EventRecordStatusStuttered

	EventRecordStatusAll = EventRecordStatusStuttered | EventRecordStatusAccepted | EventRecordStatusAccepted | EventRecordStatusPending
)

func GetState(db *sqlx.DB, publicKey []byte) (int64, error) {
	var id int64

	err := db.QueryRowx(`
	SELECT
	  actors_public_keys.actor_id
	FROM actors_public_key
	JOIN public_keys ON public_keys.id = actors_public_keys.public_key_id
	WHERE public_keys.public_key=?`,
		publicKey,
	).Scan(&id)

	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return -1, fmt.Errorf("query: %w", err)
	}

	if err == nil {
		return id, nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return -1, fmt.Errorf("begin: %w", err)
	}

	var publicKeyID int64
	err = tx.QueryRowx(`INSERT INTO public_keys (public_key) VALUES (?) RETURNING id`, publicKey).Scan(&publicKeyID)
	if err != nil {
		return -1, fmt.Errorf("insert public key: %w", err)
	}

	err = tx.QueryRowx(`INSERT INTO actors DEFAULT VALUES RETURNING id`).Scan(&id)
	if err != nil {
		return -1, fmt.Errorf("insert actor: %w", err)
	}

	_, err = tx.Exec(`INSERT INTO actors_public_keys (actor_id, public_key_id) VALUES (?, ?)`, id, publicKeyID)
	if err != nil {
		return -1, fmt.Errorf("insert actors_public_keys: %w", err)
	}

	err = tx.Commit()
	if err != nil {
		return -1, fmt.Errorf("commit: %w", err)
	}

	return id, nil
}

func InsertEvents(db *sqlx.DB, sourceActorID int64, events []*proto.Event) ([]int64, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}

	ids := make([]int64, len(events))

	for i, event := range events {
		ts := time.Now().UnixMilli()*1000 + rand.Int63n(1000)

		event.Ts = ts

		data, err := protolib.Marshal(event)
		if err != nil {
			return nil, fmt.Errorf("marshalling event to proto: %w", err)
		}

		_, err = tx.Exec(
			"INSERT INTO events (ts, source_actor_id, data, status) VALUES (?,?,?,?)",
			ts,
			sourceActorID,
			data,
			EventRecordStatusPending,
		)
		if err != nil {
			return nil, fmt.Errorf("exec: %w", err)
		}

		ids[i] = ts
	}

	err = tx.Commit()
	if err != nil {
		return nil, fmt.Errorf("tx commit: %w", err)
	}

	return ids, nil
}

type EventRecord struct {
	SourceActorID int64
	Event         *proto.Event
	Status        EventRecordStatus
}

func GetEvents(db *sqlx.DB, from int64, statusMask EventRecordStatus) ([]EventRecord, error) {
	var events []EventRecord

	result, err := db.Queryx(
		`SELECT
		   source_actor_id,
		   data,
		   status
		FROM events
		WHERE
		  ts > ?
		AND
		  status & ? != 0
		ORDER BY ts ASC`,
		from,
		statusMask,
	)
	if err != nil {
		return events, fmt.Errorf("query: %w", err)
	}

	for result.Next() {
		var event EventRecord

		var data []byte

		err = result.Rows.Scan(
			&event.SourceActorID,
			&data,
			&event.Status,
		)
		if err != nil {
			return events, fmt.Errorf("scan: %w", err)
		}

		err = protolib.Unmarshal(data, event.Event)
		if err != nil {
			return events, fmt.Errorf("proto unmarshall: %w", err)
		}

		events = append(events, event)
	}

	return events, nil
}

func UpdateEventStatus(db *sqlx.DB, eventTs int64, status EventRecordStatus) error {
	result, err := db.Exec(
		`
		UPDATE events
		SET status = ?
		WHERE ts=?
		`,
		status,
		eventTs,
	)
	if err != nil {
		return fmt.Errorf("exec: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("RowsAffected: %w", err)
	}

	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}
