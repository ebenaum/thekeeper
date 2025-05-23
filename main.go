package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	_ "embed"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

func usage() string {
	return fmt.Sprintf("./cmd http|https <certfile> <keyfile>|create-orga <handle>|link-orga <handle>")
}

//go:embed schema.sql
var schema string

func main() {
	db, err := sqlx.Open("sqlite3", "./foo.db?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}

	defer db.Close()

	_, err = db.Exec(schema)
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
	case "https":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = httpsserver(db)
	case "create-orga":
		if len(os.Args) < 3 {
			fmt.Println(usage())
			os.Exit(1)
		}

		err = createorga(db, os.Args[2])
	case "link-orga":
		if len(os.Args) < 3 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = linkorga(db, os.Args[2])
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

	return http.ListenAndServe(":80", nil)
}

func httpsserver(db *sqlx.DB) error {
	http.HandleFunc("/state", HandleState(db))
	http.HandleFunc("/auth/handles/{handle}", HandleCreateAuthKey(db))
	http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))

	return http.ListenAndServeTLS(":443", os.Args[2], os.Args[3], nil)
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

func linkorga(db *sqlx.DB, orgaHandle string) error {
	actorIDToLink, err := FindActorIDByHandle(db, orgaHandle)
	if err != nil {
		return fmt.Errorf("find actor by handle: %w", err)
	}

	authKey, err := InsertAuthKey(db, actorIDToLink)
	if err != nil {
		return fmt.Errorf("inserting link code %w", err)
	}

	fmt.Printf("http://localhost:8080?code=%s\n", authKey)

	return nil
}
