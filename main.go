package main

import (
	cryptorand "crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	_ "embed"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

func usage() string {
	return "./cmd http <db-path>|https <db-path> <certfile> <keyfile>|create-orga <db-path> <handle>|link-orga <db-path> <handle>|delete-player <db-path> <player id>|delete-character <db-path> <character id>|invite <db-path> <email> [handle]"
}

//go:embed schema.sql
var schema string

func main() {
	if len(os.Args) < 3 {
		fmt.Println(usage())
		os.Exit(1)
	}

	db, err := sqlx.Open("sqlite3", fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000", os.Args[2]))
	if err != nil {
		log.Fatal(err)
	}

	defer db.Close()

	_, err = db.Exec(schema)
	if err != nil {
		log.Fatal(err)
	}

	// Migration: add email column if not present (idempotent for existing DBs)
	_, _ = db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	switch os.Args[1] {
	case "http":
		err = httpserver(db)
	case "https":
		if len(os.Args) < 5 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = httpsserver(db)
	case "reset":
		err = insertreset(db)
	case "create-orga":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}

		err = createorga(db, os.Args[3])
	case "link-orga":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = linkorga(db, os.Args[3])

	case "delete-player":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = deleteplayer(db, os.Args[3])
	case "delete-character":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = deletecharacter(db, os.Args[3])
	case "invite":
		if len(os.Args) < 4 {
			fmt.Println(usage())
			os.Exit(1)
		}

		explicitHandle := ""
		if len(os.Args) >= 5 {
			explicitHandle = os.Args[4]
		}

		err = invite(db, os.Args[3], explicitHandle)
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

func httpsserver(db *sqlx.DB) error {
	http.HandleFunc("/state", HandleState(db))
	http.HandleFunc("/auth/handles/{handle}", HandleCreateAuthKey(db))
	http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))

	return http.ListenAndServeTLS(":443", os.Args[3], os.Args[4], nil)
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

func insertreset(db *sqlx.DB) error {
	result, err := InsertAndCheckEvents(db, -1, 0, []*proto.Event{
		{
			Msg: &proto.Event_Reset_{},
		},
	})
	if err != nil {
		return fmt.Errorf("seeding actor event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("seeding actor event was not accepted: %v", result[0])
	}

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

func deleteplayer(db *sqlx.DB, playerID string) error {
	result, err := InsertAndCheckEvents(db, -1, 0, []*proto.Event{
		{
			Msg: &proto.Event_DeletePlayer{
				DeletePlayer: &proto.EventDeletePlayer{
					PlayerId: playerID,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("delete player event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("delete player event was not accepted: %v", result[0])
	}

	return nil
}

func deletecharacter(db *sqlx.DB, characterID string) error {
	result, err := InsertAndCheckEvents(db, -1, 0, []*proto.Event{
		{
			Msg: &proto.Event_DeleteCharacter{
				DeleteCharacter: &proto.EventDeleteCharacter{
					CharacterId: characterID,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("delete character event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("delete characyer event was not accepted: %v", result[0])
	}

	return nil
}

func generateHandle(email string) string {
	local := email
	if idx := strings.Index(email, "@"); idx != -1 {
		local = email[:idx]
	}

	handle := strings.ToLower(local)
	// Replace non-alphanumeric with -
	var buf strings.Builder
	for _, r := range handle {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			buf.WriteRune(r)
		} else {
			buf.WriteRune('-')
		}
	}
	handle = buf.String()

	// Trim leading/trailing dashes
	handle = strings.Trim(handle, "-")

	if handle == "" {
		handle = "player"
	}

	return handle
}

func generateUniqueHandle(db *sqlx.DB, email string, explicitHandle string) (string, error) {
	handle := explicitHandle
	if handle == "" {
		handle = generateHandle(email)
	}

	// Check if handle already taken
	_, err := FindActorIDByHandle(db, handle)
	if err != nil {
		// Not found — handle is available
		return handle, nil
	}

	// Collision — append random suffix
	suffix := cryptorand.Text()[:6]
	handle = handle + "-" + suffix

	return handle, nil
}

func invite(db *sqlx.DB, email string, explicitHandle string) error {
	smtpCfg, err := LoadSMTPConfig()
	if err != nil {
		return fmt.Errorf("SMTP config: %w", err)
	}

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		return fmt.Errorf("APP_URL environment variable is required")
	}

	handle, err := generateUniqueHandle(db, email, explicitHandle)
	if err != nil {
		return fmt.Errorf("generate handle: %w", err)
	}

	actorID, err := CreatePlayerActor(db, email)
	if err != nil {
		return fmt.Errorf("create actor: %w", err)
	}

	result, err := InsertAndCheckEvents(db, -1, actorID, []*proto.Event{
		{
			Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: handle,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("seed actor event: %w", err)
	}

	if result[0].Status != EventRecordStatusAccepted {
		return fmt.Errorf("seed actor event not accepted: %v", result[0])
	}

	code, err := InsertAuthKey(db, actorID)
	if err != nil {
		return fmt.Errorf("insert auth key: %w", err)
	}

	err = SendInviteEmail(smtpCfg, email, appURL, code)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}

	fmt.Printf("Invited %s as %q (actor %d)\n", email, handle, actorID)

	return nil
}
