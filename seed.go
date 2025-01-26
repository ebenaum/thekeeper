package main

import "fmt"

type Seed struct {
	Index int `json:"index"`
}

func (s Seed) Key() string {
	return "seed"
}

func (s Seed) Validate(top Top) error {
	if s.Index != len(top.Players) {
		return fmt.Errorf("index should be %d", len(top.Players))
	}

	return nil
}

func (s Seed) Mutate(top Top) Top {
	top.Players = append(top.Players, Player{})

	return top
}
