package main

import (
	cryptorand "crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
	protolib "google.golang.org/protobuf/proto"
)

type ActorSpace string

const (
	ActorSpaceOrga   ActorSpace = "orga"
	ActorSpacePlayer ActorSpace = "player"
)

type EventRecordStatus uint64

const (
	EventRecordStatusPending EventRecordStatus = 1 << iota
	EventRecordStatusAccepted
	EventRecordStatusRejected

	EventRecordStatusAll = EventRecordStatusAccepted | EventRecordStatusRejected | EventRecordStatusPending
)

func (e EventRecordStatus) MarshalJSON() ([]byte, error) {
	switch e {
	case EventRecordStatusAccepted:
		return []byte(`"accepted"`), nil
	case EventRecordStatusPending:
		return []byte(`"pending"`), nil
	case EventRecordStatusRejected:
		return []byte(`"rejected"`), nil
	default:
		return nil, fmt.Errorf("EventRecordStatus %d not supported", e)
	}
}

func LinkState(db *sqlx.DB, actorID int64, publicKey []byte) (ActorSpace, error) {
	var space ActorSpace

	err := db.QueryRowx(`
	SELECT
	  actors.space
	FROM actors
	WHERE actors.id=?`,
		actorID,
	).Scan(&space)
	if err != nil {
		return "", fmt.Errorf("query: %w", err)
	}

	tx, err := db.Beginx()
	if err != nil {
		return "", fmt.Errorf("begin: %w", err)
	}

	var publicKeyID int64
	err = tx.QueryRowx(`INSERT INTO public_keys (public_key) VALUES (?) RETURNING id`, publicKey).Scan(&publicKeyID)
	if err != nil {
		return "", fmt.Errorf("insert public key: %w", err)
	}

	_, err = tx.Exec(`INSERT INTO actors_public_keys (actor_id, public_key_id) VALUES (?, ?)`, actorID, publicKeyID)
	if err != nil {
		return "", fmt.Errorf("insert actors_public_keys: %w", err)
	}

	err = tx.Commit()
	if err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}

	return space, nil
}

func InsertAuthKey(db *sqlx.DB, actorID int64) (string, error) {
	key := cryptorand.Text()

	_, err := db.Exec(`INSERT INTO auth_keys (key, actor_id, redeemed_at) VALUES (?, ?, NULL)`, key, actorID)
	if err != nil {
		return "", fmt.Errorf("exec: %w", err)
	}

	return key, nil
}

func FindActorIDByHandle(db *sqlx.DB, handle string) (int64, error) {
	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		return -1, fmt.Errorf("get events: %w", err)
	}

	for _, record := range records {
		event := record.Event

		switch v := event.Msg.(type) {
		case *proto.Event_SeedActor:
			if v.SeedActor.Handle == handle {
				return record.SourceActorID, nil
			}
		}
	}

	return -1, fmt.Errorf("handle not found for handle %q", handle)
}

func GetActorSpaceByActorID(db *sqlx.DB, actorID int64) (ActorSpace, error) {
	var space ActorSpace

	return space, db.QueryRowx(`
	SELECT
	  space
	FROM actors
	WHERE id=?`,
		actorID,
	).Scan(
		&space,
	)
}

func UseAuthKey(db *sqlx.DB, key string) (int64, error) {
	var actorID int64

	err := db.QueryRowx(
		`UPDATE auth_keys SET redeemed_at=? WHERE key=? RETURNING actor_id`,
		time.Now().UTC().Unix(),
		key,
	).Scan(&actorID)
	if err != nil {
		return -1, fmt.Errorf("query: %w", err)
	}

	return actorID, nil
}

func GetState(db *sqlx.DB, publicKey []byte) (int64, ActorSpace, error) {
	var id int64
	var space ActorSpace

	err := db.QueryRowx(`
	SELECT
	  actors_public_keys.actor_id,
	  actors.space
	FROM actors_public_keys
	JOIN public_keys ON public_keys.id = actors_public_keys.public_key_id
	JOIN actors ON actors.id = actors_public_keys.actor_id
	WHERE public_keys.public_key=?`,
		publicKey,
	).Scan(&id, &space)

	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return -1, "", fmt.Errorf("query: %w", err)
	}

	if err == nil {
		return id, space, nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return -1, "", fmt.Errorf("begin: %w", err)
	}

	var publicKeyID int64
	err = tx.QueryRowx(`INSERT INTO public_keys (public_key) VALUES (?) RETURNING id`, publicKey).Scan(&publicKeyID)
	if err != nil {
		return -1, "", fmt.Errorf("insert public key: %w", err)
	}

	err = tx.QueryRowx(`INSERT INTO actors DEFAULT VALUES RETURNING id, space`).Scan(&id, &space)
	if err != nil {
		return -1, "", fmt.Errorf("insert actor: %w", err)
	}

	_, err = tx.Exec(`INSERT INTO actors_public_keys (actor_id, public_key_id) VALUES (?, ?)`, id, publicKeyID)
	if err != nil {
		return -1, "", fmt.Errorf("insert actors_public_keys: %w", err)
	}

	err = tx.Commit()
	if err != nil {
		return -1, "", fmt.Errorf("commit: %w", err)
	}

	return id, space, nil
}

func InsertEvents(db *sqlx.DB, sourceActorID int64, events []*proto.Event) ([]int64, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}

	ids := make([]int64, len(events))

	ts := time.Now().UnixMilli()*1000 + rand.Int63n(1000)

	for i, event := range events {
		ts += int64(i)

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
	Event         proto.Event
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

		err = protolib.Unmarshal(data, &event.Event)
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
