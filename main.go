package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

func usage() string {
	return fmt.Sprintf("./cmd http|create-orga <handle>")
}

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

	if len(os.Args) < 2 {
		fmt.Println(usage())
		os.Exit(1)
	}

	switch os.Args[1] {
	case "http":
		err = httpserver(db)
	case "create-orga":
		if len(os.Args) < 3 {
			fmt.Println(usage())
			os.Exit(1)
		}

		err = createorga(db, os.Args[2])
	default:
		fmt.Println(usage())
		os.Exit(1)
	}

	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func httpserver(db *sqlx.DB) error {
	http.HandleFunc("/state", HandleState(db))
	http.HandleFunc("/auth/handles/{handle}", HandleCreateAuthKey(db))
	http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))

	return http.ListenAndServe(":8081", nil)
}

func createorga(db *sqlx.DB, orgaHandle string) error {
	var id int64

	err := db.QueryRowx(
		`INSERT INTO actors (space) VALUES (?) RETURNING id`,
		ActorSpaceOrga,
	).Scan(&id)
	if err != nil {
		return fmt.Errorf("insert actor: %w", err)
	}

	result, err := InsertAndCheckEvents(db, -1, id, []*proto.Event{
		{
			Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: orgaHandle,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("seeding actor event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("seeding actor event was not accepted: %v", result[0])
	}

	result, err = InsertAndCheckEvents(db, -1, 0, []*proto.Event{
		{
			Msg: &proto.Event_Permission{
				Permission: &proto.EventPermission{
					ActorId:    id,
					Permission: PermissionOrga,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("insert permission event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("inserting permission event was not accepted: %v", result[0])
	}

	code, err := InsertAuthKey(db, id)
	if err != nil {
		return fmt.Errorf("inserting link code %w", err)
	}

	fmt.Println("Code:", code)

	return nil
}
