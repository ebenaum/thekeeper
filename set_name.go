package main

import "fmt"

type SetName struct {
	Firstname string `json:"firstname"`
	Lastname  string `json:"lastname"`
}

func (s SetName) Key() string {
	return "set-name"
}

func (s SetName) Validate(state State) error {

	if state.Firstname != "" && state.Lastname != "" {
		return fmt.Errorf("already set")
	}

	return nil
}

func (s SetName) Mutate(state State) State {
	state.Firstname = s.Firstname
	state.Lastname = s.Lastname

	return state
}
