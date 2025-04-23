package main

import (
	"log"
	"net/http"
	"os"

	"github.com/jmoiron/sqlx"
)

func main() {
	db, err := sqlx.Open("sqlite3", "./foo.db?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}

	defer db.Close()

	migration, err := os.ReadFile("schema.sql")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(string(migration))
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/state", HandleState(db))
	log.Fatal(http.ListenAndServe(":8081", nil))

}
