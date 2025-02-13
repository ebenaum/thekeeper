package main

import (
	"fmt"
)

const RootActorID = 0

type Event[T any] interface {
	Key() string
	Validate(T) error
	Mutate(T) T
}

type BaseEvent struct {
	SourceActorID int `json:"-"`
}

type EventRegistry[T any] map[string]func() Event[T]

func (e EventRegistry[T]) Register(eventFns ...func() Event[T]) error {
	for _, eventFn := range eventFns {
		if _, exists := e[eventFn().Key()]; exists {
			return fmt.Errorf("duplicate event key %q", eventFn().Key())
		}

		e[eventFn().Key()] = eventFn
	}

	return nil
}

func (e EventRegistry[T]) Get(key string) (Event[T], bool) {
	eventFn, exists := e[key]
	if !exists {
		return nil, false
	}

	return eventFn(), true
}
