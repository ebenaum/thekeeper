package main

type LockPlayer struct {
	PlayerID string `json:"string"`
}

func (l LockPlayer) Key() string {
	return "lock-player"
}

func (l LockPlayer) Index() string {
	return l.Key() + "-" + l.PlayerID
}

func (l LockPlayer) ValidateSpace() ([]string, []any) {
	return []string{"index1=?"}, []any{LockPlayerPermission{}.Key()}
}

func (s SetName) Mutate(top Top) Top {

}
