package main

import (
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
	"github.com/lestrrat-go/jwx/jwk"
	_ "github.com/mattn/go-sqlite3"
)

type Error struct {
	Public  error
	Private error
}

func (e Error) Error() string {
	return e.Private.Error()
}

func auth(db *sqlx.DB, tokenString string) (int64, error) {
	var stateID int64
	var publicKey ecdsa.PublicKey

	_, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		jwkJSON, err := json.Marshal(token.Header["jwk"])
		if err != nil {
			return nil, Error{errors.New("invalid public key"), fmt.Errorf("json marshal: %w", err)}
		}

		jwkKey, err := jwk.ParseKey(jwkJSON)
		if err != nil {
			return nil, Error{errors.New("invalid public key"), fmt.Errorf("parse jwk key: %w", err)}
		}

		jwkECDSAKey, ok := jwkKey.(jwk.ECDSAPublicKey)
		if !ok {
			return nil, Error{errors.New("invalid public key"), fmt.Errorf("public key is not jwk.ECDSAPublicKey: %v", jwkECDSAKey)}
		}

		err = jwkECDSAKey.Raw(&publicKey)
		if err != nil {
			return nil, Error{errors.New("invalid public key"), fmt.Errorf("get ecdsa.PublicKey: %w", err)}
		}

		return &publicKey, nil

	},
		jwt.WithValidMethods([]string{jwt.SigningMethodES256.Alg()}),
		jwt.WithIssuedAt(),
		jwt.WithAudience("thekeeper"),
		jwt.WithExpirationRequired(),
		jwt.WithIssuer("self"),
	)
	if err != nil {
		return stateID, err
	}

	record, err := GetState(db, append(publicKey.X.Bytes(), publicKey.Y.Bytes()...))
	if err != nil {
		return stateID, Error{errors.New("invalid public key"), fmt.Errorf("get state: %w", err)}
	}

	stateID = record.ID

	return stateID, err
}

func GETState(db *sqlx.DB, eventRegistry EventRegistry[Top]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		if r.Method != http.MethodGet && r.Method != http.MethodOptions {
			POSTState(db, eventRegistry)(w, r)

			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)

			return
		}

		stateID, err := auth(db, r.Header.Get("Authorization"))
		if err != nil {
			var errplus Error

			w.WriteHeader(http.StatusBadRequest)

			if errors.As(err, &errplus) {
				log.Println(errplus.Private)
				fmt.Fprintf(w, `{"message": "%s"}`, errplus.Public.Error())

				return
			}

			log.Println(err)
			fmt.Fprintf(w, `{"message": "%s"}`, err.Error())

			return
		}

		state, _, _, err := LastState(eventRegistry, db, stateID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}

		encoder := json.NewEncoder(w)
		err = encoder.Encode(state)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}
	}
}

func POSTState(db *sqlx.DB, eventRegistry EventRegistry[Top]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)

			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization")

		start := time.Now()
		stateID, err := auth(db, r.Header.Get("Authorization"))
		fmt.Println("AUTH", time.Since(start))
		if err != nil {
			var errplus Error

			w.WriteHeader(http.StatusBadRequest)

			if errors.As(err, &errplus) {
				log.Println(errplus.Private)
				fmt.Fprintf(w, `{"message": "%s"}`, errplus.Public.Error())

				return
			}

			log.Println(err)
			fmt.Fprintf(w, `{"message": "%s"}`, err.Error())

			return
		}

		start = time.Now()
		defer func() {
			fmt.Println("APP", time.Since(start))
		}()

		type EventRequest struct {
			Key  string          `json:"key"`
			Data json.RawMessage `json:"data"`

			Error string `json:"error,omitempty"`
		}

		var eventsRequests []EventRequest

		dec := json.NewDecoder(r.Body)
		err = dec.Decode(&eventsRequests)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)

			log.Println(err)
			fmt.Fprint(w, `{"message": "bad input"}`)

			return
		}

		events := make([]Event[Top], len(eventsRequests))
		for i := range events {
			event, exists := eventRegistry.Get(eventsRequests[i].Key)
			if !exists {
				w.WriteHeader(http.StatusBadRequest)

				log.Printf("no event %q", eventsRequests[i].Key)
				fmt.Fprintf(w, `{"message": "no event %q"}`, eventsRequests[i].Key)

				return
			}

			if len(eventsRequests[i].Data) != 0 {
				err = json.Unmarshal(eventsRequests[i].Data, event)
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)

					log.Println(err)
					fmt.Fprint(w, `{"message": "bad input"}`)

					return
				}
			}

			events[i] = event
		}

		var state Top

		state, rejectedIndexes, rejectedErrors, err := Step(eventRegistry, db, stateID, events)
		for i, rejectedIndex := range rejectedIndexes {
			eventsRequests[rejectedIndex].Error = rejectedErrors[i].Error()
		}

		if err != nil {
			w.WriteHeader(http.StatusBadRequest)

			log.Println(err)
			fmt.Fprintf(w, `{"message": "%s"}`, err.Error())

			return
		}

		type Response struct {
			State  Top            `json:"state"`
			Events []EventRequest `json:"events"`
		}

		encoder := json.NewEncoder(w)
		err = encoder.Encode(Response{state, eventsRequests})
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}
	}
}
