package main

type LockPlayerPermission struct{}

func (l LockPlayerPermission) Key() string {
	return "lock-player-permission"
}

func (l LockPlayerPermission) Index() string {
	return l.Key()
}

func (l LockPlayerPermission) ValidateSpace() ([]string, []any) {
	return []string{}, []any{}
}

func (s SetName) Mutate(top Top) Top {

}
