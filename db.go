package main

import (
	cryptorand "crypto/rand"
	"database/sql"
	"fmt"
	"sync/atomic"
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
	defer tx.Rollback()

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


// InvitePlayerActor creates a player actor and its auth key in a single transaction.
func InvitePlayerActor(db *sqlx.DB, email string) (int64, string, error) {
	tx, err := db.Beginx()
	if err != nil {
		return -1, "", fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	var actorID int64
	err = tx.QueryRowx(
		`INSERT INTO actors (space, email) VALUES (?, ?) RETURNING id`,
		ActorSpacePlayer,
		email,
	).Scan(&actorID)
	if err != nil {
		return -1, "", fmt.Errorf("insert actor: %w", err)
	}

	code := cryptorand.Text()
	_, err = tx.Exec(`INSERT INTO auth_keys (key, actor_id, redeemed_at) VALUES (?, ?, NULL)`, code, actorID)
	if err != nil {
		return -1, "", fmt.Errorf("insert auth key: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return -1, "", fmt.Errorf("commit: %w", err)
	}

	return actorID, code, nil
}

func FindActorIDByEmail(db *sqlx.DB, email string) (int64, error) {
	var id int64

	err := db.QueryRowx(`SELECT id FROM actors WHERE email = ?`, email).Scan(&id)
	if err != nil {
		return -1, fmt.Errorf("find actor by email: %w", err)
	}

	return id, nil
}

func SetActorEmail(db *sqlx.DB, actorID int64, email string) error {
	res, err := db.Exec(`UPDATE actors SET email = ? WHERE id = ?`, email, actorID)
	if err != nil {
		return fmt.Errorf("set actor email: %w", err)
	}

	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("set actor email: actor %d not found", actorID)
	}

	return nil
}

func UseAuthKey(db *sqlx.DB, key string) (int64, error) {
	var actorID int64

	err := db.QueryRowx(
		`UPDATE auth_keys SET redeemed_at=? WHERE key=? AND redeemed_at IS NULL RETURNING actor_id`,
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
	if err != nil {
		return -1, "", fmt.Errorf("unknown public key: %w", err)
	}

	return id, space, nil
}

var lastTs atomic.Int64

func nextTimestamp() int64 {
	now := time.Now().UnixMicro()
	for {
		last := lastTs.Load()
		next := now
		if next <= last {
			next = last + 1
		}
		if lastTs.CompareAndSwap(last, next) {
			return next
		}
	}
}

func InsertEvents(db *sqlx.DB, sourceActorID int64, events []*proto.Event) ([]int64, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	ids := make([]int64, len(events))

	for i, event := range events {
		ts := nextTimestamp()

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
