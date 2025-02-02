package main

type Seed struct {
	BaseEvent

	ID string `json:"id"`
}

func (s Seed) Key() string {
	return "seed"
}

func (s Seed) Index() string {
	return s.Key() + "-" + s.ID
}

func (s Seed) ValidateSpace() ([]string, []any) {
	return []string{"index1=?"}, []any{s.Index()}
}

func (s Seed) Validate(events []EventRecord) error {
	return nil
}

func (s Seed) Mutate(top Top) Top {
	top.Players = append(top.Players, Player{})

	return top
}
