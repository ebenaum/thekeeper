package main

import (
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
	"github.com/lestrrat-go/jwx/jwk"
	_ "github.com/mattn/go-sqlite3"
	protolib "google.golang.org/protobuf/proto"
)

type Error struct {
	Public  error
	Private error
}

func (e Error) Error() string {
	return e.Private.Error()
}

func auth(db *sqlx.DB, tokenString string) (int64, string, error) {
	var actorID int64
	var actorSpace string
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
		return actorID, actorSpace, err
	}

	actorID, actorSpace, err = GetState(db, append(publicKey.X.Bytes(), publicKey.Y.Bytes()...))
	if err != nil {
		return actorID, actorSpace, Error{errors.New("invalid public key"), fmt.Errorf("get state: %w", err)}
	}

	return actorID, actorSpace, err
}

func HandleState(db *sqlx.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		if r.Method != http.MethodGet && r.Method != http.MethodOptions {
			POSTState(db)(w, r)

			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)

			return
		}

		actorID, _, err := auth(db, r.Header.Get("Authorization"))
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

		start := time.Now()
		defer func() {
			fmt.Println("APP GET", time.Since(start))
		}()

		from, err := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
		if err != nil {
			log.Println(err)
			fmt.Fprintf(w, `{"message": "%s"}`, err.Error())

			return
		}

		events, err := FetchEvents(db, actorID, from)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}

		response := &proto.Events{
			Events: events,
		}

		responseEncoded, err := protolib.Marshal(response)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}

		//		w.Header().Set("Content-Type", "application/x-protobuf")

		_, err = w.Write(responseEncoded)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}

	}
}

func POSTState(db *sqlx.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)

			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization")

		start := time.Now()
		actorID, _, err := auth(db, r.Header.Get("Authorization"))
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
			fmt.Println("APP POST", time.Since(start))
		}()

		var eventsRequests proto.Events

		body, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)

			log.Println(err)
			fmt.Fprint(w, `{"message": "bad input"}`)

			return
		}

		err = protolib.Unmarshal(body, &eventsRequests)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)

			log.Println(err)
			fmt.Fprint(w, `{"message": "bad input"}`)

			return
		}

		if len(eventsRequests.Events) == 0 {
			w.WriteHeader(http.StatusBadRequest)

			fmt.Fprint(w, `{"message": "bad input"}`)

			return
		}

		result, err := InsertAndCheckEvents(db, -1, actorID, eventsRequests.Events)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)

			log.Println(err)
			fmt.Fprintf(w, `{"message": "%s"}`, err.Error())

			return
		}

		encoder := json.NewEncoder(w)
		err = encoder.Encode(result)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)

			log.Println(err)

			return
		}
	}
}
