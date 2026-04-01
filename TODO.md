# TheKeeper — Remaining improvements

## #9 — Full replay from genesis on every request [Performance]

Both writes (`Run()` via `InsertAndCheckEvents`) and reads (`FetchEvents`) replay the entire event history from scratch on every HTTP request. This is O(N) where N is the total event count. Fine at current scale (~2k-5k events) but degrades linearly with no ceiling.

**Suggested approach:**
- Keep `SpaceValidation` as an in-memory singleton (protected by mutex), rebuilt only on server start.
- On each `InsertAndCheckEvents`, process only newly inserted events against the existing state.
- For reads, consider a per-projection cache or accept current cost (reads skip validation so they're cheaper).
- `TestGobEncodeDecode` in `space_validation_test.go` already validates that `SpaceValidation` can be serialized with gob — useful if periodic snapshots to disk are needed later.

**Files involved:** `state.go` (Run, FetchEvents), `space_validation.go` (SpaceValidation).

## #12 — No rate limiting on actor self-registration [Hardening]

`GetState` in `db.go:144` auto-creates a new player actor for any unseen public key. Any client generating fresh ECDSA keypairs can flood the `actors` table. Low practical risk for a LARP with known participants but worth hardening.

**Options:**
- **Invitation-only:** Require a valid auth key to create an actor. Return 401 for unknown keys. Most secure but changes the onboarding flow.
- **In-memory rate limiter:** Track new actor creation per IP (e.g., 5/hour). Lightweight, doesn't change the flow.
- **Registration cap:** Hard limit on total actors (`SELECT COUNT(*) FROM actors`). Simple and appropriate for a fixed-size event.

**Files involved:** `db.go` (GetState), `http.go` (auth).
