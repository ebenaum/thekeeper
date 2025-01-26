package main

type SetFirstname struct {
	Firstname string `json:"firstname"`
}

func (s SetFirstname) Key() string {
	return "set-firstname"
}

func (s SetFirstname) Validate(state State) error {
	return nil
}

func (s SetFirstname) Mutate(state State) State {
	state.Firstname = s.Firstname

	return state
}
