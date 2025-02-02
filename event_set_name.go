package main

type SetName struct {
	BaseEvent

	PlayerID  string `json:"id"`
	Firstname string `json:"firstname"`
	Lastname  string `json:"lastname"`
}

func (s SetName) Key() string {
	return "set-name"
}

func (s SetName) Index() string {
	return s.Key()
}

func (s SetName) ValidateSpace() ([]string, []any) {
	return []string{"index1=?"}, []any{Seed{ID: s.PlayerID}.Index()}
}

func (s SetName) Mutate(top Top) Top {
	top.Players[s.Index].Firstname = s.Firstname
	top.Players[s.Index].Lastname = s.Lastname

	return top
}
