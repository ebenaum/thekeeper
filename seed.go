package main

type Seed struct{}

func (s Seed) Key() string {
	return "seed"
}

func (s Seed) Validate(state State) error {
	return nil
}

func (s Seed) Mutate(state State) State {
	return State{}
}
