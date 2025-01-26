package main

import "fmt"

type SetName struct {
	Index     int    `json:"index"`
	Firstname string `json:"firstname"`
	Lastname  string `json:"lastname"`
}

func (s SetName) Key() string {
	return "set-name"
}

func (s SetName) Validate(top Top) error {
	if len(top.Players) <= s.Index {
		return fmt.Errorf("no player at index %d", s.Index)
	}

	if top.Players[s.Index].Firstname != "" && top.Players[s.Index].Lastname != "" {
		return fmt.Errorf("already set")
	}

	return nil
}

func (s SetName) Mutate(top Top) Top {
	top.Players[s.Index].Firstname = s.Firstname
	top.Players[s.Index].Lastname = s.Lastname

	return top
}
