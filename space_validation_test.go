package main

import (
	"testing"

	"github.com/ebenaum/thekeeper/proto"
)

func TestValidation(t *testing.T) {
	space := SpaceValidation{
		Handles: Handles{
			m: map[string]int64{
				"benoit": 1,
			},
			actors: map[int64]string{
				0: "",
				1: "benoit",
			},
		},
		Permission: Permission{
			actors: map[int64]string{
				0: PermissionRoot,
				1: PermissionOrga,
			},
		},
		PlayersIDs: map[string]struct{ ActorID int64 }{},
	}

	steps := []struct {
		sourceActorID int64
		event         *proto.Event
	}{
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
	}

	for i, step := range steps {
		err := space.Process(step.sourceActorID, step.event)

		if err != nil {
			t.Logf("#%d: %v\n", i, err)
		} else {
			t.Logf("#%d: OK\n", i)
		}
	}

	t.Log("actors", space.Handles.actors)
	t.Log("players", space.PlayersIDs)
}
