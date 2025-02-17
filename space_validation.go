package main

import (
	"fmt"

	"github.com/ebenaum/thekeeper/proto"
)

type Actor struct {
	Handle  string
	Players map[string]struct{}
}

type SpaceValidation struct {
	Handles    map[string]int64
	Permission Permission
	PlayersIDs map[string]struct{}
	Actors     map[int64]Actor
}

func (s *SpaceValidation) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		if _, exists := s.Handles[v.SeedActor.Handle]; exists {
			return fmt.Errorf("handler already exists")
		}

		if s.Actors[sourceActorID].Handle != "" {
			return fmt.Errorf("handler already exists")
		}

		s.Handles[v.SeedActor.Handle] = sourceActorID
		s.Actors[sourceActorID] = Actor{
			v.SeedActor.Handle,
			make(map[string]struct{}),
		}

		return nil
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_SeedPlayer:
		actorID := s.Handles[v.SeedPlayer.Handle]
		if sourceActorID != actorID && s.Permission.actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		if _, exists := s.PlayersIDs[v.SeedPlayer.PlayerId]; exists {
			return fmt.Errorf("player already exists")
		}

		s.PlayersIDs[v.SeedPlayer.PlayerId] = struct{}{}
		s.Actors[actorID].Players[v.SeedPlayer.PlayerId] = struct{}{}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}
}

type SpacePlayer struct {
	Handles    map[string]int64
	Permission Permission
	ActorID    int64
	Events     []*proto.Event
	Actors     map[int64]string
}

func (s *SpacePlayer) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		s.Handles[v.SeedActor.Handle] = sourceActorID
		s.Actors[sourceActorID] = v.SeedActor.Handle

		return nil
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_SeedPlayer:
		actorID := s.Handles[v.SeedPlayer.Handle]
		if actorID == s.ActorID || s.Permission.actors[s.ActorID] == PermissionOrga {
			s.Events = append(s.Events, event)
		}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}
}
