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
	Handles    Handles
	Permission Permission
	PlayersIDs map[string]struct {
		ActorID int64
	}
}

type Handles struct {
	m      map[string]int64
	actors map[int64]string
}

func (h Handles) Process(sourceActorID int64, event *proto.EventSeedActor) error {
	if event.Handle == "" {
		return fmt.Errorf("invalid handle")
	}

	if _, exists := h.m[event.Handle]; exists {
		return fmt.Errorf("handle already exists")
	}

	if _, exists := h.actors[sourceActorID]; exists {
		return fmt.Errorf("handle already exists")
	}

	h.m[event.Handle] = sourceActorID
	h.actors[sourceActorID] = event.Handle

	return nil
}

func (s *SpaceValidation) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		return s.Handles.Process(sourceActorID, v.SeedActor)
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_SeedPlayer:
		actorID, exists := s.Handles.m[v.SeedPlayer.Handle]
		if !exists {
			return fmt.Errorf("not authorized")
		}

		if sourceActorID != actorID && s.Permission.actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		if _, exists := s.PlayersIDs[v.SeedPlayer.PlayerId]; exists {
			return fmt.Errorf("player already exists")
		}

		s.PlayersIDs[v.SeedPlayer.PlayerId] = struct{ ActorID int64 }{actorID}

		return nil
	case *proto.Event_PlayerPerson:
		player, exists := s.PlayersIDs[v.PlayerPerson.PlayerId]
		if !exists {
			return fmt.Errorf("player does not exist")
		}
		if sourceActorID != player.ActorID && s.Permission.actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}
}

type SpacePlayer struct {
	Handles    Handles
	Permission Permission
	ActorID    int64
	Events     []*proto.Event
	PlayerIDs  map[string]struct{}
}

func (s *SpacePlayer) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		return s.Handles.Process(sourceActorID, v.SeedActor)
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_SeedPlayer:
		actorID := s.Handles.m[v.SeedPlayer.Handle]
		if actorID == s.ActorID || s.Permission.actors[s.ActorID] == PermissionOrga {
			s.Events = append(s.Events, event)
			s.PlayerIDs[v.SeedPlayer.PlayerId] = struct{}{}
		}

		return nil
	case *proto.Event_PlayerPerson:
		if _, exists := s.PlayerIDs[v.PlayerPerson.PlayerId]; exists {
			s.Events = append(s.Events, event)
		}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}

}
