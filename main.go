package main

import (
	cryptorand "crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/ebenaum/thekeeper/proto"
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

	if len(os.Args) < 2 {
		fmt.Printf("./cmd http|create-orga")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "http":
		http.HandleFunc("/state", HandleState(db))
		http.HandleFunc("/auth/actors/{actor_id}", HandleCreateAuthKey(db))
		http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))
		log.Fatal(http.ListenAndServe(":8081", nil))
	case "create-orga":
		var id int64

		err = db.QueryRowx(
			`INSERT INTO actors (space) VALUES (?) RETURNING id`,
			ActorSpaceOrga,
		).Scan(&id)
		if err != nil {
			fmt.Printf("insert actor: %v\n", err)
			os.Exit(1)
		}

		result, err := InsertAndCheckEvents(db, -1, id, []*proto.Event{
			{
				Msg: &proto.Event_SeedActor{
					SeedActor: &proto.EventSeedActor{
						Handle: cryptorand.Text(),
					},
				},
			},
		})
		if err != nil {
			fmt.Printf("seeding actor event: %v\n", err)
			os.Exit(1)
		}

		if result[0].Status != EventRecordStatusAccepted {
			fmt.Printf("seeding actor event was not accepted: %v\n", result[0])
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
			fmt.Printf("insert permission event: %v\n", err)
			os.Exit(1)
		}

		if result[0].Status != EventRecordStatusAccepted {
			fmt.Printf("inserting permission event was not accepted: %v\n", result[0])
		}

		code, err := InsertAuthKey(db, id)
		if err != nil {
			fmt.Printf("inserting linl code %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Code:", code)
	default:
		fmt.Println("./cmd http|create-orga")
		os.Exit(1)
	}

}
