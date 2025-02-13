package main

import (
	"fmt"

	"github.com/ebenaum/thekeeper/proto"
)

type SpaceValidation struct {
	Handles    map[string]int64
	Permission Permission
	PlayersIDs map[string]struct{}
	Actors     map[int64]struct {
		Handle  string
		Players map[string]struct{}
	}
}

func (s *SpaceValidation) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.EventActor:
		if _, exists := s.Handles[v.Actor.Handle]; exists {
			return fmt.Errorf("handler already exists")
		}
		if s.Actors[sourceActorID].Handle != "" {
			return fmt.Errorf("handler already exists")
		}

		s.Handles[v.Actor.Handle] = sourceActorID
		s.Actors[sourceActorID].Handle = v.Actor.Handle

		return nil
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_Seed:
		actorID := s.Handles[v.Seed.Handle]
		if sourceActorID != actorID && s.Permission.actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		if _, exists := s.PlayersIDs[v.Seed.PlayerId]; exists {
			return fmt.Errorf("player already exists")
		}

		s.PlayersIDs[v.Seed.PlayerId] = struct{}{}
		s.Actors[actorID].Players[v.Seed.PlayerId] = struct{}{}

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
	Actors     map[int64]struct {
		Handle string
	}
}

func (s *SpacePlayer) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.EventActor:
		s.Handles[v.Actor.Handle] = sourceActorID
		s.Actors[sourceActorID].Handle = v.Actor.Handle

		return nil
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_Seed:
		actorID := s.Handles[v.Seed.Handle]
		if actorID == s.ActorID || s.Permission.actors[s.ActorID] == PermissionOrga {
			s.Events = append(s.Events, event)
		}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}
}
