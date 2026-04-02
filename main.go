package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"os"

	_ "embed"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

func usage() string {
	return "./cmd http <db-path>|https <db-path> <certfile> <keyfile>|create-orga <db-path> <handle> <email>|link-orga <db-path> <handle>|delete-player <db-path> <player id>|delete-character <db-path> <character id>|invite <db-path> <email>|migrate-emails <db-path>|list-actors <db-path>"
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
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_actors_email ON actors(email) WHERE email IS NOT NULL`); err != nil {
		log.Fatalf("create email index: %v", err)
	}

	smtpCfg, _ := LoadSMTPConfig() // OK if not set — CLI commands that need it will fail with a clear error
	appURL := os.Getenv("APP_URL")

	switch os.Args[1] {
	case "http":
		err = httpserver(db, smtpCfg, appURL)
	case "https":
		if len(os.Args) < 5 {
			fmt.Println(usage())
			os.Exit(1)
		}
		err = httpsserver(db, smtpCfg, appURL)
	case "reset":
		err = insertreset(db)
	case "create-orga":
		if len(os.Args) < 5 {
			fmt.Println(usage())
			os.Exit(1)
		}

		err = createorga(db, os.Args[3], os.Args[4])
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

		err = invite(db, os.Args[3])
	case "migrate-emails":
		dryRun := len(os.Args) >= 4 && os.Args[3] == "--dry-run"
		err = migrateEmails(db, dryRun)
	case "list-actors":
		err = listActors(db)
	default:
		fmt.Println(usage())
		os.Exit(1)
	}

	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func httpserver(db *sqlx.DB, smtpCfg SMTPConfig, appURL string) error {
	http.HandleFunc("/state", HandleState(db))
	http.HandleFunc("/auth/handles/{handle}", HandleCreateAuthKey(db))
	http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))
	http.HandleFunc("/auth/invite", HandleInvite(db, smtpCfg, appURL))
	http.HandleFunc("/auth/request-link", HandleRequestLink(db, smtpCfg, appURL))

	return http.ListenAndServe(":8081", nil)
}

func httpsserver(db *sqlx.DB, smtpCfg SMTPConfig, appURL string) error {
	http.HandleFunc("/state", HandleState(db))
	http.HandleFunc("/auth/handles/{handle}", HandleCreateAuthKey(db))
	http.HandleFunc("/auth/redeem/{key}", HandleRedeemAuthKey(db))
	http.HandleFunc("/auth/invite", HandleInvite(db, smtpCfg, appURL))
	http.HandleFunc("/auth/request-link", HandleRequestLink(db, smtpCfg, appURL))

	return http.ListenAndServeTLS(":443", os.Args[3], os.Args[4], nil)
}

func createorga(db *sqlx.DB, orgaHandle string, email string) error {
	if _, err := mail.ParseAddress(email); err != nil {
		return fmt.Errorf("invalid email %q: %w", email, err)
	}

	var id int64

	err := db.QueryRowx(
		`INSERT INTO actors (space, email) VALUES (?, ?) RETURNING id`,
		ActorSpaceOrga,
		email,
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

func invite(db *sqlx.DB, email string) error {
	smtpCfg, err := LoadSMTPConfig()
	if err != nil {
		return fmt.Errorf("SMTP config: %w", err)
	}

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		return fmt.Errorf("APP_URL environment variable is required")
	}

	if _, err := mail.ParseAddress(email); err != nil {
		return fmt.Errorf("invalid email %q: %w", email, err)
	}

	if _, err := FindActorIDByEmail(db, email); err == nil {
		return fmt.Errorf("email %q already invited", email)
	}

	actorID, code, err := InvitePlayerActor(db, email)
	if err != nil {
		return fmt.Errorf("invite: %w", err)
	}

	err = SendInviteEmail(smtpCfg, email, appURL, code)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}

	fmt.Printf("Invited %s (actor %d)\n", email, actorID)

	return nil
}

func migrateEmails(db *sqlx.DB, dryRun bool) error {
	// Replay events to build player→actor mapping
	sv := NewSpaceValidation()

	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		return fmt.Errorf("get events: %w", err)
	}

	// Track latest PlayerPerson contact per player ID
	playerContacts := map[string]string{}

	for _, record := range records {
		sv.Process(record.SourceActorID, &record.Event)

		if pp, ok := record.Event.Msg.(*proto.Event_PlayerPerson); ok {
			playerContacts[pp.PlayerPerson.PlayerId] = pp.PlayerPerson.Contact
		}
	}

	// Resolve emails and detect duplicates
	type resolved struct {
		playerID string
		actorID  int64
		email    string
	}

	var withEmail []resolved
	var noEmail []resolved
	emailCount := map[string][]resolved{}

	for playerID, contact := range playerContacts {
		player, exists := sv.PlayersIDs[playerID]
		if !exists {
			continue
		}

		addr, err := mail.ParseAddress(contact)
		if err != nil {
			noEmail = append(noEmail, resolved{playerID: playerID, actorID: player.ActorID, email: contact})
			continue
		}

		r := resolved{playerID: playerID, actorID: player.ActorID, email: addr.Address}
		withEmail = append(withEmail, r)
		emailCount[addr.Address] = append(emailCount[addr.Address], r)
	}

	if dryRun {
		fmt.Println("=== DRY RUN ===")
		fmt.Println()

		fmt.Printf("--- With valid email (%d) ---\n", len(withEmail))
		for _, r := range withEmail {
			handle := sv.Handles.IDToHandle[r.actorID]
			fmt.Printf("  actor %d (%s) player %s → %s\n", r.actorID, handle, r.playerID, r.email)
		}

		fmt.Printf("\n--- Without valid email (%d) ---\n", len(noEmail))
		for _, r := range noEmail {
			handle := sv.Handles.IDToHandle[r.actorID]
			fmt.Printf("  actor %d (%s) player %s — contact: %q\n", r.actorID, handle, r.playerID, r.email)
		}

		hasDuplicates := false
		for email, entries := range emailCount {
			if len(entries) > 1 {
				if !hasDuplicates {
					fmt.Printf("\n--- Duplicate emails ---\n")
					hasDuplicates = true
				}
				fmt.Printf("  %s:\n", email)
				for _, r := range entries {
					handle := sv.Handles.IDToHandle[r.actorID]
					fmt.Printf("    actor %d (%s) player %s\n", r.actorID, handle, r.playerID)
				}
			}
		}
		if !hasDuplicates {
			fmt.Println("\nNo duplicate emails found.")
		}

		fmt.Printf("\nSummary: %d would migrate, %d would skip\n", len(withEmail), len(noEmail))
		return nil
	}

	migrated := 0
	skipped := 0

	for _, r := range withEmail {
		err := SetActorEmail(db, r.actorID, r.email)
		if err != nil {
			fmt.Printf("ERROR player %s (actor %d): %v\n", r.playerID, r.actorID, err)
			skipped++
			continue
		}

		fmt.Printf("OK   player %s (actor %d): %s\n", r.playerID, r.actorID, r.email)
		migrated++
	}

	for _, r := range noEmail {
		fmt.Printf("SKIP player %s (actor %d): could not parse %q\n", r.playerID, r.actorID, r.email)
		skipped++
	}

	fmt.Printf("\nMigrated: %d, Skipped: %d\n", migrated, skipped)

	return nil
}

func listActors(db *sqlx.DB) error {
	sv := NewSpaceValidation()

	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		return fmt.Errorf("get events: %w", err)
	}

	for _, record := range records {
		sv.Process(record.SourceActorID, &record.Event)
	}

	rows, err := db.Queryx(`SELECT id, space, email FROM actors WHERE id != 0 ORDER BY id`)
	if err != nil {
		return fmt.Errorf("query actors: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var space ActorSpace
		var email sql.NullString

		if err := rows.Scan(&id, &space, &email); err != nil {
			return fmt.Errorf("scan: %w", err)
		}

		handle := sv.Handles.IDToHandle[id]
		if handle == "" {
			handle = "(no handle)"
		}

		emailStr := ""
		if email.Valid {
			emailStr = email.String
		}

		fmt.Printf("actor %d  %s  %s  %s\n", id, space, handle, emailStr)
	}

	return nil
}
