package main

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"
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
