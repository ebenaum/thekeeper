# Invite-Based Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace self-registration with orga-initiated email invitations, add email-based login link requests, and allow unauthenticated users to play with the character form.

**Architecture:** New `email.go` for SMTP. DB functions in `db.go` for actor creation with email and email lookup. Two new HTTP handlers in `http.go`. CLI commands in `main.go`. `GetState` is simplified to reject unknown keys. Frontend gets a demo mode in `app.js`.

**Tech Stack:** Go `net/smtp`, `net/mail`, SQLite, vanilla JS `localStorage`

---

## File Structure

| File                  | Responsibility                                                                         |
| --------------------- | -------------------------------------------------------------------------------------- |
| `email.go` (new)      | SMTP config, `SendEmail`, `SendInviteEmail`                                            |
| `email_test.go` (new) | Unit tests for email config loading, template rendering                                |
| `db.go`               | New `CreatePlayerActor`, `FindActorIDByEmail`, `SetActorEmail`. Simplified `GetState`. |
| `db_test.go`          | Tests for new DB functions and `GetState` rejection                                    |
| `http.go`             | New `HandleInvite`, `HandleRequestLink` handlers                                       |
| `schema.sql`          | Add `email` column to `actors`                                                         |
| `main.go`             | New `invite` and `migrate-emails` CLI commands, wire new HTTP routes, schema migration |
| `public/app.js`       | Demo mode for `personnage.html` without auth                                           |

---

### Task 1: Schema migration — add email column to actors

**Files:**

- Modify: `schema.sql`
- Modify: `main.go:35-38`

- [ ] **Step 1: Add email column to schema.sql**

Add `email TEXT` to the `actors` table definition:

```sql
CREATE TABLE IF NOT EXISTS actors (
    id INTEGER PRIMARY KEY,
    space TEXT CHECK( space IN ('orga','player') ) NOT NULL DEFAULT 'player',
    email TEXT
);
```

- [ ] **Step 2: Add ALTER TABLE migration in main.go**

After the `db.Exec(schema)` call in `main.go:35-38`, add an idempotent migration that adds the `email` column for existing databases:

```go
_, err = db.Exec(schema)
if err != nil {
    log.Fatal(err)
}

// Migration: add email column if not present (idempotent for existing DBs)
_, _ = db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)
```

The `ALTER TABLE` will error on new databases (column already exists from CREATE TABLE) and that's fine — we discard the error.

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `go test -count=1 ./...`
Expected: all 42 tests PASS. The new column has no impact on existing queries.

- [ ] **Step 4: Commit**

```bash
git add schema.sql main.go
git commit -m "feat: add email column to actors table with idempotent migration"
```

---

### Task 2: SMTP email — config and sending

**Files:**

- Create: `email.go`
- Create: `email_test.go`

- [ ] **Step 1: Write tests for SMTP config loading and template rendering**

Create `email_test.go`:

```go
package main

import (
	"os"
	"strings"
	"testing"
)

func TestLoadSMTPConfig(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr bool
	}{
		{
			"all vars set",
			map[string]string{
				"SMTP_HOST":     "smtp.example.com",
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
				"SMTP_FROM":     "from@example.com",
			},
			false,
		},
		{
			"missing host",
			map[string]string{
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
				"SMTP_FROM":     "from@example.com",
			},
			true,
		},
		{
			"missing from",
			map[string]string{
				"SMTP_HOST":     "smtp.example.com",
				"SMTP_PORT":     "587",
				"SMTP_USER":     "user",
				"SMTP_PASSWORD": "pass",
			},
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Clearenv()
			for k, v := range tt.env {
				os.Setenv(k, v)
			}

			cfg, err := LoadSMTPConfig()
			if (err != nil) != tt.wantErr {
				t.Errorf("LoadSMTPConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if cfg.Host != tt.env["SMTP_HOST"] {
					t.Errorf("Host = %q, want %q", cfg.Host, tt.env["SMTP_HOST"])
				}
				if cfg.From != tt.env["SMTP_FROM"] {
					t.Errorf("From = %q, want %q", cfg.From, tt.env["SMTP_FROM"])
				}
			}
		})
	}
}

func TestRenderInviteEmail(t *testing.T) {
	body := RenderInviteEmail("https://app.ebenaum.fr", "TESTCODE123")

	if !strings.Contains(body, "https://app.ebenaum.fr?code=TESTCODE123") {
		t.Errorf("email body should contain the invite link, got: %s", body)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test -count=1 -run 'TestLoadSMTPConfig|TestRenderInviteEmail' ./...`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement email.go**

Create `email.go`:

```go
package main

import (
	"fmt"
	"net/smtp"
	"os"
)

type SMTPConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	From     string
}

func LoadSMTPConfig() (SMTPConfig, error) {
	cfg := SMTPConfig{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     os.Getenv("SMTP_PORT"),
		User:     os.Getenv("SMTP_USER"),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     os.Getenv("SMTP_FROM"),
	}

	if cfg.Host == "" {
		return cfg, fmt.Errorf("SMTP_HOST is required")
	}
	if cfg.Port == "" {
		cfg.Port = "587"
	}
	if cfg.From == "" {
		return cfg, fmt.Errorf("SMTP_FROM is required")
	}

	return cfg, nil
}

func RenderInviteEmail(appURL string, code string) string {
	link := fmt.Sprintf("%s?code=%s", appURL, code)

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<body>
<h2>Ebenaum GN 2026</h2>
<p>Tu as reçu une invitation pour créer ton personnage !</p>
<p><a href="%s">Clique ici pour commencer</a></p>
<p>Ou copie ce lien dans ton navigateur :</p>
<p>%s</p>
</body>
</html>`, link, link)
}

func SendEmail(cfg SMTPConfig, to string, subject string, body string) error {
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=\"UTF-8\"\r\n\r\n%s",
		cfg.From, to, subject, body)

	auth := smtp.PlainAuth("", cfg.User, cfg.Password, cfg.Host)

	return smtp.SendMail(
		fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
		auth,
		cfg.From,
		[]string{to},
		[]byte(msg),
	)
}

func SendInviteEmail(cfg SMTPConfig, to string, appURL string, code string) error {
	body := RenderInviteEmail(appURL, code)
	return SendEmail(cfg, to, "Ebenaum GN 2026 — Ton invitation", body)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test -count=1 -run 'TestLoadSMTPConfig|TestRenderInviteEmail' ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add email.go email_test.go
git commit -m "feat: add SMTP email config and invite email template"
```

---

### Task 3: New DB functions — CreatePlayerActor, FindActorIDByEmail, SetActorEmail

**Files:**

- Modify: `db.go`
- Modify: `db_test.go`

- [ ] **Step 1: Write tests for new DB functions**

Add to `db_test.go`:

```go
func TestCreatePlayerActor(t *testing.T) {
	db := setupTestDB(t)

	// Migration: add email column
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	actorID, err := CreatePlayerActor(db, "player@example.com")
	if err != nil {
		t.Fatal(err)
	}

	if actorID <= 0 {
		t.Errorf("expected positive actor ID, got %d", actorID)
	}

	// Verify email stored
	var email sql.NullString
	err = db.QueryRowx("SELECT email FROM actors WHERE id = ?", actorID).Scan(&email)
	if err != nil {
		t.Fatal(err)
	}
	if !email.Valid || email.String != "player@example.com" {
		t.Errorf("email = %v, want player@example.com", email)
	}

	// Verify space is player
	space, err := GetActorSpaceByActorID(db, actorID)
	if err != nil {
		t.Fatal(err)
	}
	if space != ActorSpacePlayer {
		t.Errorf("space = %q, want %q", space, ActorSpacePlayer)
	}
}

func TestFindActorIDByEmail(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	actorID, _ := CreatePlayerActor(db, "find-me@example.com")

	tests := []struct {
		name    string
		email   string
		wantID  int64
		wantErr bool
	}{
		{"existing email", "find-me@example.com", actorID, false},
		{"non-existent email", "nobody@example.com", -1, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, err := FindActorIDByEmail(db, tt.email)
			if (err != nil) != tt.wantErr {
				t.Errorf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && gotID != tt.wantID {
				t.Errorf("got ID %d, want %d", gotID, tt.wantID)
			}
		})
	}
}

func TestSetActorEmail(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	var actorID int64
	db.QueryRowx("INSERT INTO actors (space) VALUES ('player') RETURNING id").Scan(&actorID)

	err := SetActorEmail(db, actorID, "new@example.com")
	if err != nil {
		t.Fatal(err)
	}

	foundID, err := FindActorIDByEmail(db, "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if foundID != actorID {
		t.Errorf("got ID %d, want %d", foundID, actorID)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test -count=1 -run 'TestCreatePlayerActor|TestFindActorIDByEmail|TestSetActorEmail' ./...`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the DB functions in db.go**

Add to `db.go`, after the `GetActorSpaceByActorID` function:

```go
func CreatePlayerActor(db *sqlx.DB, email string) (int64, error) {
	var id int64

	err := db.QueryRowx(
		`INSERT INTO actors (space, email) VALUES (?, ?) RETURNING id`,
		ActorSpacePlayer,
		email,
	).Scan(&id)
	if err != nil {
		return -1, fmt.Errorf("insert actor: %w", err)
	}

	return id, nil
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
	_, err := db.Exec(`UPDATE actors SET email = ? WHERE id = ?`, email, actorID)
	if err != nil {
		return fmt.Errorf("set actor email: %w", err)
	}

	return nil
}
```

- [ ] **Step 4: Add `database/sql` import to db_test.go if not present**

Add `"database/sql"` to the imports in `db_test.go`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test -count=1 -run 'TestCreatePlayerActor|TestFindActorIDByEmail|TestSetActorEmail' ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add db.go db_test.go
git commit -m "feat: add CreatePlayerActor, FindActorIDByEmail, SetActorEmail"
```

---

### Task 4: Remove self-registration from GetState

**Files:**

- Modify: `db.go:145-196`
- Modify: `db_test.go`

- [ ] **Step 1: Write test for GetState rejecting unknown keys**

Add to `db_test.go`:

```go
func TestGetState_RejectsUnknownKey(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	unknownKey := []byte("unknown-public-key-bytes-here-32")

	_, _, err := GetState(db, unknownKey)
	if err == nil {
		t.Error("GetState should reject unknown public keys")
	}
}

func TestGetState_AcceptsKnownKey(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`ALTER TABLE actors ADD COLUMN email TEXT`)

	// Create an actor and link a key
	actorID, err := CreatePlayerActor(db, "test@example.com")
	if err != nil {
		t.Fatal(err)
	}

	publicKey := []byte("known-public-key-bytes-here--32!")

	_, err = LinkState(db, actorID, publicKey)
	if err != nil {
		t.Fatal(err)
	}

	gotID, gotSpace, err := GetState(db, publicKey)
	if err != nil {
		t.Fatal(err)
	}
	if gotID != actorID {
		t.Errorf("got ID %d, want %d", gotID, actorID)
	}
	if gotSpace != ActorSpacePlayer {
		t.Errorf("got space %q, want %q", gotSpace, ActorSpacePlayer)
	}
}
```

- [ ] **Step 2: Run tests — the reject test should fail (current code auto-creates)**

Run: `go test -count=1 -run 'TestGetState_Rejects|TestGetState_Accepts' ./...`
Expected: `TestGetState_RejectsUnknownKey` FAILS (auto-creates actor), `TestGetState_AcceptsKnownKey` PASSES.

- [ ] **Step 3: Simplify GetState to reject unknown keys**

Replace the `GetState` function in `db.go:145-196` with:

```go
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
```

This removes the entire auto-creation transaction block (lines 168-195 of the original). Unknown keys now return an error.

- [ ] **Step 4: Remove unused imports if needed**

Check if `database/sql` and `errors` are still used in `db.go`. `errors` is no longer used (the `sql.ErrNoRows` check was removed). Remove unused imports.

Wait — `database/sql` is still used in `UseAuthKey` and `UpdateEventStatus`. And `errors` was only used for `errors.Is(err, sql.ErrNoRows)` in the old `GetState`. Remove `errors` from the import if no other usage remains.

Actually, check: `errors` is not imported in `db.go` currently — it's in `http.go`. The old `GetState` used `errors.Is` from the `errors` package. Verify and clean up.

- [ ] **Step 5: Run all tests**

Run: `go test -count=1 ./...`
Expected: All tests PASS. The existing `TestFetchEvents` and `TestInsertAndCheckEvents_Acceptance` tests create actors via direct SQL INSERT (bypassing `GetState`), so they're unaffected.

- [ ] **Step 6: Commit**

```bash
git add db.go db_test.go
git commit -m "feat: remove self-registration, GetState rejects unknown public keys"
```

---

### Task 5: invite CLI command

**Files:**

- Modify: `main.go`

- [ ] **Step 1: Add handle generation helper**

Add to `main.go` (or `db.go` — but it's a CLI concern, so `main.go` is fine):

```go
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
```

- [ ] **Step 2: Add the invite command function**

Add to `main.go`:

```go
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
```

- [ ] **Step 3: Wire the invite command in the main switch**

Add to the `switch` block in `main.go`, before the `default` case. Also add the `"strings"` import and update the usage string.

```go
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
```

Update the `usage()` function to include `invite <db-path> <email> [handle]`.

Add `"strings"` and `cryptorand "crypto/rand"` to the `main.go` imports (crypto/rand is already available via the import alias in db.go but main.go needs its own reference; actually since they're in the same package, it's fine — just add `"strings"`).

- [ ] **Step 4: Build to verify compilation**

Run: `go build ./...`
Expected: success, no errors.

- [ ] **Step 5: Commit**

```bash
git add main.go
git commit -m "feat: add invite CLI command for email-based player onboarding"
```

---

### Task 6: migrate-emails CLI command

**Files:**

- Modify: `main.go`

- [ ] **Step 1: Add the migrate-emails command function**

Add to `main.go`:

```go
func migrateEmails(db *sqlx.DB) error {
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

	migrated := 0
	skipped := 0

	for playerID, contact := range playerContacts {
		player, exists := sv.PlayersIDs[playerID]
		if !exists {
			continue
		}

		addr, err := mail.ParseAddress(contact)
		if err != nil {
			fmt.Printf("SKIP player %s (actor %d): could not parse %q\n", playerID, player.ActorID, contact)
			skipped++
			continue
		}

		err = SetActorEmail(db, player.ActorID, addr.Address)
		if err != nil {
			fmt.Printf("ERROR player %s (actor %d): %v\n", playerID, player.ActorID, err)
			skipped++
			continue
		}

		fmt.Printf("OK   player %s (actor %d): %s\n", playerID, player.ActorID, addr.Address)
		migrated++
	}

	fmt.Printf("\nMigrated: %d, Skipped: %d\n", migrated, skipped)

	return nil
}
```

- [ ] **Step 2: Wire the command in the main switch**

Add before the `default` case:

```go
case "migrate-emails":
    err = migrateEmails(db)
```

Add `"net/mail"` to the imports in `main.go`.

Update the `usage()` string to include `migrate-emails <db-path>`.

- [ ] **Step 3: Build to verify compilation**

Run: `go build ./...`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add main.go
git commit -m "feat: add migrate-emails CLI to backfill actor emails from PlayerPerson.contact"
```

---

### Task 7: POST /auth/invite endpoint (orga-only)

**Files:**

- Modify: `http.go`
- Modify: `main.go` (wire route)

- [ ] **Step 1: Add HandleInvite to http.go**

Add to `http.go`:

```go
func HandleInvite(db *sqlx.DB, smtpCfg SMTPConfig, appURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodOptions {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		_, actorSpace, err := auth(db, r.Header.Get("Authorization"))
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			writeJSON(w, "not authorized")
			return
		}

		if actorSpace != ActorSpaceOrga {
			w.WriteHeader(http.StatusForbidden)
			writeJSON(w, "not authorized")
			return
		}

		var req struct {
			Email  string `json:"email"`
			Handle string `json:"handle"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, "bad input")
			return
		}

		if req.Email == "" {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, "email is required")
			return
		}

		handle, err := generateUniqueHandle(db, req.Email, req.Handle)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			log.Println(err)
			writeJSON(w, "internal error")
			return
		}

		actorID, err := CreatePlayerActor(db, req.Email)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			log.Println(err)
			writeJSON(w, "internal error")
			return
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
		if err != nil || result[0].Status != EventRecordStatusAccepted {
			w.WriteHeader(http.StatusInternalServerError)
			log.Printf("seed actor failed: err=%v result=%v", err, result)
			writeJSON(w, "internal error")
			return
		}

		code, err := InsertAuthKey(db, actorID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			log.Println(err)
			writeJSON(w, "internal error")
			return
		}

		if err := SendInviteEmail(smtpCfg, req.Email, appURL, code); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			log.Println(err)
			writeJSON(w, "failed to send email")
			return
		}

		writeJSON(w, handle)
	}
}
```

- [ ] **Step 2: Wire the route in httpserver and httpsserver**

In `main.go`, modify `httpserver` and `httpsserver` to accept `SMTPConfig` and `appURL`, and register the new route. Load SMTP config and APP_URL before calling the server functions:

```go
// In httpserver and httpsserver, add the new route:
http.HandleFunc("/auth/invite", HandleInvite(db, smtpCfg, appURL))
```

Update the `httpserver` and `httpsserver` signatures to accept `smtpCfg SMTPConfig` and `appURL string`. Load them in `main()` before the switch:

```go
smtpCfg, _ := LoadSMTPConfig() // OK if not set — CLI commands that need it will fail with a clear error
appURL := os.Getenv("APP_URL")
```

Pass `smtpCfg` and `appURL` to `httpserver`/`httpsserver`.

- [ ] **Step 3: Move `generateHandle` and `generateUniqueHandle` to `db.go`**

Since these are now used by both `main.go` (CLI) and `http.go` (API handler), move them to `db.go` so both can access them. They're already in the same package, but keeping them near the DB functions they call is cleaner.

- [ ] **Step 4: Build to verify compilation**

Run: `go build ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add http.go main.go db.go
git commit -m "feat: add POST /auth/invite endpoint for orga-initiated invitations"
```

---

### Task 8: POST /auth/request-link endpoint (public)

**Files:**

- Modify: `http.go`
- Modify: `main.go` (wire route)

- [ ] **Step 1: Add HandleRequestLink to http.go**

```go
func HandleRequestLink(db *sqlx.DB, smtpCfg SMTPConfig, appURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodOptions {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		var req struct {
			Email string `json:"email"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusOK)
			writeJSON(w, "if this email is registered, a link has been sent")
			return
		}

		// Always return the same response to prevent email enumeration
		defer func() {
			writeJSON(w, "if this email is registered, a link has been sent")
		}()

		if req.Email == "" {
			return
		}

		actorID, err := FindActorIDByEmail(db, req.Email)
		if err != nil {
			// Email not found — do nothing, same response
			return
		}

		code, err := InsertAuthKey(db, actorID)
		if err != nil {
			log.Printf("request-link: insert auth key for actor %d: %v", actorID, err)
			return
		}

		if err := SendInviteEmail(smtpCfg, req.Email, appURL, code); err != nil {
			log.Printf("request-link: send email to %s: %v", req.Email, err)
		}
	}
}
```

- [ ] **Step 2: Wire the route**

Add to `httpserver` and `httpsserver` in `main.go`:

```go
http.HandleFunc("/auth/request-link", HandleRequestLink(db, smtpCfg, appURL))
```

- [ ] **Step 3: Build to verify compilation**

Run: `go build ./...`
Expected: success.

- [ ] **Step 4: Run all tests**

Run: `go test -count=1 ./...`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add http.go main.go
git commit -m "feat: add POST /auth/request-link for public email-based login links"
```

---

### Task 9: Character form demo mode (frontend)

**Files:**

- Modify: `public/app.js`

- [ ] **Step 1: Understand the current gating logic**

In `public/app.js`, the main entry point (around line 2521) does:

1. Check for `?code=` param → redeem flow
2. Else → `getState()` which loads keypair from localStorage
3. If `getState()` returns null (no stored keys) → calls `init()` which generates a keypair and POSTs a SeedActor event to the server

With self-registration removed, `init()` will fail (server rejects unknown keys). The fix: when there are no stored keys AND no auth code, enter demo mode instead of calling `init()`.

- [ ] **Step 2: Add demo mode detection**

In `public/app.js`, find the section after the auth code handling (around line 2572-2574):

```javascript
} else {
    state = await getState();
}
```

Replace with:

```javascript
} else {
    state = await getState();

    if (!state) {
      // No stored session and no auth code — enter demo mode
      // Character form is usable but nothing is saved to the server
      const demoMessage = document.createElement("div");
      demoMessage.className = "demo-banner";
      demoMessage.innerHTML = `
        <p>Tu peux explorer la création de personnage librement.
        Pour sauvegarder ton personnage, demande une invitation à l'organisation.</p>
        <p>Tu as déjà reçu un lien ? <a href="#" id="request-link-btn">Demande un nouveau lien de connexion</a></p>
      `;
      containerElement.prepend(demoMessage);

      // Set up request-link form
      const requestLinkBtn = document.getElementById("request-link-btn");
      if (requestLinkBtn) {
        requestLinkBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          const email = prompt("Entre ton adresse email :");
          if (email) {
            await fetch(`${globalThis.env.thekeeperURL}/auth/request-link`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            alert("Si cette adresse est enregistrée, un lien t'a été envoyé par email.");
          }
        });
      }

      return;
    }
}
```

- [ ] **Step 3: Make personnage.html accessible in demo mode**

The character form page (`personnage.html`) likely also calls `getState()` or requires auth. Check if it has its own initialization. If it redirects to index when not authenticated, adjust it to work locally with `localStorage` for field persistence. The exact changes depend on how `personnage.html` initializes — the engineer should read the page's script to identify the auth gate and bypass it in demo mode, storing form data to `localStorage` instead of posting events.

- [ ] **Step 4: Test manually**

1. Clear localStorage in the browser
2. Open `http://localhost:8080`
3. Verify: demo banner appears, no server errors
4. Navigate to character form, fill in fields
5. Verify: form works, no network requests to `/state`
6. Close and reopen — verify localStorage restores form data (if implemented)

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add demo mode for unauthenticated character form browsing"
```

---

### Task 10: Final integration test

**Files:**

- All

- [ ] **Step 1: Run all backend tests**

Run: `go test -v -count=1 ./...`
Expected: all tests PASS.

- [ ] **Step 2: Build the binary**

Run: `go build -o thekeeper .`
Expected: success.

- [ ] **Step 3: Manual end-to-end smoke test**

1. Start the server: `APP_URL=http://localhost:8080 ./thekeeper http test.db`
2. Invite a test player: `APP_URL=http://localhost:8080 SMTP_HOST=... ./thekeeper invite test.db test@example.com test-player`
   (If no real SMTP, verify the command creates the actor and prints output. The email send will fail but actor creation should succeed.)
3. Open `http://localhost:8080` with no stored keys — verify demo mode appears
4. Open the invite link `http://localhost:8080?code=<code>` — verify redemption works
5. Verify authenticated user can create characters normally

- [ ] **Step 4: Clean up test.db**

```bash
rm -f test.db test.db-wal test.db-shm
```

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git status
# If any remaining changes, commit them
```
