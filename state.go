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

func Apply(state State, events []Event) (State, []int, []error) {
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

func Step(eventRegistry EventRegistry, db *sqlx.DB, stateID int64, events []Event) (State, []int, []error, error) {
	ids, err := InsertEvents(db, stateID, events)
	if err != nil {
		return State{}, nil, nil, fmt.Errorf("insert events: %w", err)
	}

	state, rejectedIds, rejectedErrors, err := LastState(eventRegistry, db, stateID)
	if err != nil {
		return State{}, nil, nil, fmt.Errorf("last state: %w", err)
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

func LastState(eventRegistry EventRegistry, db *sqlx.DB, stateID int64) (State, []int64, []error, error) {
	eventsRecords, err := GetEvents(db, stateID)
	if err != nil {
		return State{}, nil, nil, fmt.Errorf("get events: %w", err)
	}

	events := make([]Event, len(eventsRecords))

	for i, record := range eventsRecords {
		event, exist := eventRegistry.Get(record.Key)
		if !exist {
			return State{}, nil, nil, fmt.Errorf("no event %q in registry", record.Key)
		}

		err = json.Unmarshal(record.Data, &event)
		if err != nil {
			return State{}, nil, nil, fmt.Errorf("unmarshal event type %q: %w", event.Key(), err)
		}

		events[i] = event
	}

	state, rejectedIndexes, rejectedErrors := Apply(State{}, events)

	rejectedIds := make([]int64, len(rejectedIndexes))
	for i := range rejectedIndexes {
		rejectedIds[i] = eventsRecords[rejectedIndexes[i]].ID
	}

	return state, rejectedIds, rejectedErrors, nil
}

type Event interface {
	Key() string
	Validate(State) error
	Mutate(State) State
}

type EventRegistry map[string]func() Event

func (e EventRegistry) Register(eventFns ...func() Event) error {
	for _, eventFn := range eventFns {
		if _, exists := e[eventFn().Key()]; exists {
			return fmt.Errorf("duplicate event key %q", eventFn().Key())
		}

		e[eventFn().Key()] = eventFn
	}

	return nil
}

func (e EventRegistry) Get(key string) (Event, bool) {
	eventFn, exists := e[key]
	if !exists {
		return nil, false
	}

	return eventFn(), true
}
