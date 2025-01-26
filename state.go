package main

import (
	"encoding/json"
	"fmt"

	"github.com/jmoiron/sqlx"
)

type AgeSegment string

const (
	Below12 AgeSegment = "-12"
	Below18 AgeSegment = "-18"
	Below99 AgeSegment = "-99"
)

type State struct {
	ID int64 `json:"-"`

	Firstname string `json:"firstname"`
	Lastname  string `json:"lastname"`
}

func Apply[T any](state T, events []Event[T]) (T, []int, []error) {
	var errors []error
	var rejectedIndexes []int

	for i, event := range events {
		if err := event.Validate(state); err != nil {
			errors = append(errors, err)
			rejectedIndexes = append(rejectedIndexes, i)

			continue
		}

		state = event.Mutate(state)
	}

	return state, rejectedIndexes, errors
}

func Step[T any](eventRegistry EventRegistry[T], db *sqlx.DB, stateID int64, events []Event[T]) (T, []int, []error, error) {
	var state T

	ids, err := InsertEvents(db, stateID, events)
	if err != nil {
		return state, nil, nil, fmt.Errorf("insert events: %w", err)
	}

	state, rejectedIds, rejectedErrors, err := LastState(eventRegistry, db, stateID)
	if err != nil {
		return state, nil, nil, fmt.Errorf("last state: %w", err)
	}

	var (
		ownRejectedIndexes []int
		ownRejectedErrors  []error
	)

	for i, rejectedId := range rejectedIds {
		for j, id := range ids {
			if rejectedId == id {
				ownRejectedIndexes = append(ownRejectedIndexes, j)
				ownRejectedErrors = append(ownRejectedErrors, rejectedErrors[i])

				break
			}
		}
	}

	return state, ownRejectedIndexes, ownRejectedErrors, nil
}

func LastState[T any](eventRegistry EventRegistry[T], db *sqlx.DB, stateID int64) (T, []int64, []error, error) {
	var state T

	eventsRecords, err := GetEvents(db, stateID)
	if err != nil {
		return state, nil, nil, fmt.Errorf("get events: %w", err)
	}

	events := make([]Event[T], len(eventsRecords))

	for i, record := range eventsRecords {
		event, exist := eventRegistry.Get(record.Key)
		if !exist {
			return state, nil, nil, fmt.Errorf("no event %q in registry", record.Key)
		}

		err = json.Unmarshal(record.Data, &event)
		if err != nil {
			return state, nil, nil, fmt.Errorf("unmarshal event type %q: %w", event.Key(), err)
		}

		events[i] = event
	}

	state, rejectedIndexes, rejectedErrors := Apply(state, events)

	rejectedIds := make([]int64, len(rejectedIndexes))
	for i := range rejectedIndexes {
		rejectedIds[i] = eventsRecords[rejectedIndexes[i]].ID
	}

	return state, rejectedIds, rejectedErrors, nil
}
