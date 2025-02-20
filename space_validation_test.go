package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
)

func TestValidation(t *testing.T) {
	space := SpaceValidation{
		Handles: Handles{
			m: map[string]int64{},
			actors: map[int64]string{
				0: "",
			},
		},
		Permission: Permission{
			actors: map[int64]string{
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

	t.Log("actors", space.Handles.actors)
	t.Log("players", space.PlayersIDs)

	t.Log("PLAYER VIEW")

	playerSpace := SpacePlayer{
		ActorID: 3,
		Handles: Handles{
			m: map[string]int64{},
			actors: map[int64]string{
				0: "",
			},
		},
		Permission: Permission{
			actors: map[int64]string{
				0: PermissionRoot,
			},
		},
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
