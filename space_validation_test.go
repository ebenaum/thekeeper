package main

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/google/go-cmp/cmp"
)

func TestValidation(t *testing.T) {
	space := SpaceValidation{
		Handles: Handles{
			HandleToID: map[string]int64{},
			IDToHandle: map[int64]string{
				0: "",
			},
		},
		Permission: Permission{
			Actors: map[int64]string{
				0: PermissionRoot,
			},
		},
		PlayersIDs: map[string]struct{ ActorID int64 }{},
	}

	type step struct {
		sourceActorID int64
		event         *proto.Event
	}

	steps := []step{
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "benoit",
				},
			}},
		},
		{
			0,
			&proto.Event{Msg: &proto.Event_Permission{
				Permission: &proto.EventPermission{
					ActorId:    1,
					Permission: PermissionOrga,
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "art-coffee",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "tea-grumpy",
				},
			}},
		},
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "art-coffee",
					PlayerId: "player:coffee-art",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "tea-grumpy",
					PlayerId: "player:grumpy-tea",
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_PlayerPerson{
				PlayerPerson: &proto.EventPlayerPerson{
					PlayerId: "player:coffee-art",
					Surname:  "Jean",
				},
			}},
		},
	}

	var acceptedEvents []step

	t.Log("VALIDATION")

	for i, step := range steps {
		err := space.Process(step.sourceActorID, step.event)

		if err != nil {
			t.Logf("#%d: %v\n", i, err)
		} else {
			acceptedEvents = append(acceptedEvents, step)
			t.Logf("#%d: OK\n", i)
		}
	}

	t.Log("actors", space.Handles.IDToHandle)
	t.Log("players", space.PlayersIDs)

	t.Log("PLAYER VIEW")

	playerSpace := SpacePlayer{
		ActorID:   3,
		PlayerIDs: map[string]struct{}{},
	}

	for i, step := range acceptedEvents {
		err := playerSpace.Process(step.sourceActorID, step.event)

		if err != nil {
			t.Logf("#%d: %v\n", i, err)
		} else {
			t.Logf("#%d: OK\n", i)
		}
	}

	t.Log("actors", playerSpace.Events)
}

func TestGobEncodeDecode(t *testing.T) {
	space := SpaceValidation{
		Handles: Handles{
			HandleToID: map[string]int64{},
			IDToHandle: map[int64]string{
				0: "",
			},
		},
		Permission: Permission{
			Actors: map[int64]string{
				0: PermissionRoot,
			},
		},
		PlayersIDs: map[string]struct{ ActorID int64 }{},
	}

	type step struct {
		sourceActorID int64
		event         *proto.Event
	}

	steps := []step{
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "benoit",
				},
			}},
		},
		{
			0,
			&proto.Event{Msg: &proto.Event_Permission{
				Permission: &proto.EventPermission{
					ActorId:    1,
					Permission: PermissionOrga,
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "art-coffee",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedActor{
				SeedActor: &proto.EventSeedActor{
					Handle: "tea-grumpy",
				},
			}},
		},
		{
			1,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "art-coffee",
					PlayerId: "player:coffee-art",
				},
			}},
		},
		{
			3,
			&proto.Event{Msg: &proto.Event_SeedPlayer{
				SeedPlayer: &proto.EventSeedPlayer{
					Handle:   "tea-grumpy",
					PlayerId: "player:grumpy-tea",
				},
			}},
		},
		{
			2,
			&proto.Event{Msg: &proto.Event_PlayerPerson{
				PlayerPerson: &proto.EventPlayerPerson{
					PlayerId: "player:coffee-art",
					Surname:  "Jean",
				},
			}},
		},
	}

	for i, step := range steps {
		err := space.Process(step.sourceActorID, step.event)

		if err != nil {
			t.Logf("#%d: %v\n", i, err)
		} else {
			t.Logf("#%d: OK\n", i)
		}
	}

	var store bytes.Buffer

	encoder := gob.NewEncoder(&store)
	decoder := gob.NewDecoder(&store)

	err := encoder.Encode(space)
	if err != nil {
		t.Fatal(err)
	}

	var cpy SpaceValidation

	t.Log(store.Len())

	err = decoder.Decode(&cpy)
	if err != nil {
		t.Fatal(err)
	}

	t.Log(cpy)
	t.Log(space)
	t.Log(cmp.Diff(cpy, space))

}
