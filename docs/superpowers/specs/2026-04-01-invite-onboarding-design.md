# Invite-based onboarding with email

## Problem

Players currently self-register by opening the app, which auto-creates an actor for any unknown public key. This has two issues:

1. Orgas must manually generate auth codes and email them by hand for device linking or re-onboarding.
2. Open self-registration exposes an attack surface (actor flooding).

The `PlayerPerson.contact` field is free-form ("email, telephone"), making it unreliable for automated communication.

## Solution

Replace self-registration with orga-initiated email invitations. Add SMTP email capability so the system can send invite links and login codes. Remove auto-registration for unknown keys entirely.

## Schema change

Add `email` column to the `actors` table. Email is PII and stays in SQL only — never serialized into protobuf events or sent to clients via projections.

```sql
ALTER TABLE actors ADD COLUMN email TEXT;
```

Executed on server startup. Ignore error if the column already exists (idempotent).

## SMTP configuration

Environment variables:

| Variable        | Example                |
| --------------- | ---------------------- |
| `SMTP_HOST`     | `ssl0.ovh.net`         |
| `SMTP_PORT`     | `587`                  |
| `SMTP_USER`     | `thekeeper@ebenaum.fr` |
| `SMTP_PASSWORD` | `...`                  |
| `SMTP_FROM`     | `thekeeper@ebenaum.fr` |

Loaded at startup by both the HTTP server and CLI commands that send email.

New file `email.go`:

- `SMTPConfig` struct loaded from env vars.
- `SendEmail(config SMTPConfig, to string, subject string, body string) error` using `net/smtp`.
- `SendInviteEmail(config SMTPConfig, to string, appURL string, code string) error` — renders a simple HTML template with the invite link and calls `SendEmail`.

## Remove self-registration

`GetState` in `db.go` currently auto-creates a new player actor when it encounters an unknown public key. This behavior is removed. Unknown public keys return an error, and the caller gets a 401-equivalent response. Only actors pre-created via the `invite` command or API can authenticate.

## Auth keys stay one-time

The `redeemed_at IS NULL` check in `UseAuthKey` stays. Reusable codes are no longer needed because players can request new codes via email at any time.

## New CLI commands

### `invite`

```
./thekeeper invite <db-path> <email> [handle]
```

1. Creates a player actor with the given email in the `actors` table.
2. Seeds the actor's handle. If no handle is provided, auto-generates one from the email local part (before `@`), lowercased, non-alphanumeric replaced with `-`. If the handle collides, appends a random suffix.
3. Generates a one-time auth key.
4. Sends an invite email with the link `<appURL>?code=<key>`.

Requires SMTP env vars to be set. The `appURL` is read from an `APP_URL` env var (e.g., `https://app.ebenaum.fr` in production, `http://localhost:8080` in development).

### `migrate-emails`

```
./thekeeper migrate-emails <db-path>
```

One-time migration for existing players:

1. Loads all accepted `PlayerPerson` events.
2. For each event, parses the `contact` field using `net/mail.ParseAddress`.
3. If a valid email is found, resolves the player's actor ID (via `PlayersIDs` in the event state) and writes it to `actors.email`.
4. Reports which actors got an email and which had unparseable contacts (for manual follow-up by the orga).

## New API endpoints

### `POST /auth/invite` (orga-only)

Request body:

```json
{ "email": "player@example.com", "handle": "some-handle" }
```

Same logic as the CLI `invite` command. Requires orga authentication. Returns the generated handle in the response. Handle is optional — auto-generated if omitted.

### `POST /auth/request-link` (public, no auth)

Request body:

```json
{ "email": "player@example.com" }
```

1. Looks up the email in `actors.email`.
2. If found, generates a new one-time auth key and sends an email with the link.
3. If not found, does nothing.
4. Always returns 200 with a generic message (`"if this email is registered, a link has been sent"`) to prevent email enumeration.

This endpoint serves as the "login", "forgot access", and "new device" flow — all the same action from the player's perspective.

## Character form demo mode (frontend)

With self-registration removed, unauthenticated visitors hitting the app see nothing useful. The `personnage.html` character creation form should be accessible without authentication as a teaser.

Changes to the frontend JS in `public/app.js`:

- Allow `personnage.html` to load and be fully interactive without a session.
- The form works locally: user can pick race, class, skills, characteristics, etc.
- No events are sent to the server. Data is persisted to `localStorage`.
- Display a prompt (e.g., "Inscris-toi pour sauvegarder ton personnage") encouraging the user to get an invite.
- Once the player is later invited and authenticated, the locally-stored character data can be submitted as real events.

## Files changed

| File            | Change                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema.sql`    | Add `email TEXT` column to `actors`                                                                                                              |
| `main.go`       | New `invite` and `migrate-emails` commands. Load SMTP config from env. Wire new HTTP handlers.                                                   |
| `db.go`         | New `CreatePlayerActor(email, handle)`. Modify `GetState` to reject unknown keys. New `GetActorEmail(actorID)`, `SetActorEmail(actorID, email)`. |
| `http.go`       | New `HandleInvite`, `HandleRequestLink` handlers.                                                                                                |
| New `email.go`  | `SMTPConfig`, `LoadSMTPConfig()`, `SendEmail()`, `SendInviteEmail()`.                                                                            |
| `public/app.js` | Demo mode for `personnage.html` without auth. `localStorage` persistence.                                                                        |

## What this does NOT include

- HelloAsso API integration (CSV export from HelloAsso is imported manually, one `invite` call per player).
- Email verification (the orga is the source of truth for email correctness).
- Bulk invite CLI (dropped — orga can script `invite` in a shell loop if needed).
- Password-based auth (stays passwordless with ECDSA keypairs).
