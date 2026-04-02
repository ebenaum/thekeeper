package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
	"github.com/lestrrat-go/jwx/jwk"
)

func createTestAuth(t *testing.T, db *sqlx.DB, actorID int64) string {
	t.Helper()

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	pubBytes := append(privateKey.PublicKey.X.Bytes(), privateKey.PublicKey.Y.Bytes()...)
	_, err = LinkState(db, actorID, pubBytes)
	if err != nil {
		t.Fatal(err)
	}

	jwkKey, err := jwk.New(&privateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	jwkJSON, err := json.Marshal(jwkKey)
	if err != nil {
		t.Fatal(err)
	}
	var jwkMap map[string]interface{}
	json.Unmarshal(jwkJSON, &jwkMap)

	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"aud": "thekeeper",
		"iss": "self",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	token.Header["jwk"] = jwkMap

	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatal(err)
	}

	return tokenString
}

func setupOrgaActor(t *testing.T, db *sqlx.DB) (int64, string) {
	t.Helper()

	var orgaID int64
	err := db.QueryRowx("INSERT INTO actors (space) VALUES ('orga') RETURNING id").Scan(&orgaID)
	if err != nil {
		t.Fatal(err)
	}

	return orgaID, createTestAuth(t, db, orgaID)
}

func TestHandleInvite_Unauthorized(t *testing.T) {
	db := setupTestDB(t)
	handler := HandleInvite(db, SMTPConfig{}, "http://test.local")

	body := `{"email":"test@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/invite", bytes.NewBufferString(body))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("got status %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestHandleInvite_ForbiddenPlayer(t *testing.T) {
	db := setupTestDB(t)

	playerID := createPlayerActor(t, db, "player@example.com")
	playerAuth := createTestAuth(t, db, playerID)

	handler := HandleInvite(db, SMTPConfig{}, "http://test.local")

	body := `{"email":"new@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/invite", bytes.NewBufferString(body))
	req.Header.Set("Authorization", playerAuth)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("got status %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestHandleInvite_BadInput(t *testing.T) {
	db := setupTestDB(t)
	_, orgaAuth := setupOrgaActor(t, db)

	handler := HandleInvite(db, SMTPConfig{}, "http://test.local")

	tests := []struct {
		name string
		body string
		want int
	}{
		{"invalid json", `{bad`, http.StatusBadRequest},
		{"empty email", `{"email":""}`, http.StatusBadRequest},
		{"invalid email", `{"email":"not-an-email"}`, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/invite", bytes.NewBufferString(tt.body))
			req.Header.Set("Authorization", orgaAuth)
			w := httptest.NewRecorder()

			handler(w, req)

			if w.Code != tt.want {
				t.Errorf("got status %d, want %d", w.Code, tt.want)
			}
		})
	}
}

func TestHandleInvite_DuplicateEmail(t *testing.T) {
	db := setupTestDB(t)
	_, orgaAuth := setupOrgaActor(t, db)

	createPlayerActor(t, db, "existing@example.com")

	handler := HandleInvite(db, SMTPConfig{}, "http://test.local")

	body := `{"email":"existing@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/invite", bytes.NewBufferString(body))
	req.Header.Set("Authorization", orgaAuth)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("got status %d, want %d", w.Code, http.StatusConflict)
	}
}

func TestHandleRequestLink_ConstantResponse(t *testing.T) {
	db := setupTestDB(t)

	createPlayerActor(t, db, "exists@example.com")

	handler := HandleRequestLink(db, SMTPConfig{}, "http://test.local")

	tests := []struct {
		name  string
		email string
	}{
		{"existing email", "exists@example.com"},
		{"non-existing email", "nobody@example.com"},
		{"empty email", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]string{"email": tt.email})
			req := httptest.NewRequest(http.MethodPost, "/auth/request-link", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			handler(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("got status %d, want %d", w.Code, http.StatusOK)
			}

			var resp jsonMessage
			json.NewDecoder(w.Body).Decode(&resp)

			if resp.Message != "if this email is registered, a link has been sent" {
				t.Errorf("got message %q, want constant anti-enumeration message", resp.Message)
			}
		})
	}
}
