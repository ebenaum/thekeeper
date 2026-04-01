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
	CharacterIDs map[string]struct {
		PlayerID string
	}
}

func NewSpaceValidation() SpaceValidation {
	return SpaceValidation{
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
		PlayersIDs:   map[string]struct{ ActorID int64 }{},
		CharacterIDs: map[string]struct{ PlayerID string }{},
	}
}

type Handles struct {
	HandleToID map[string]int64
	IDToHandle map[int64]string
}

func (h Handles) Process(sourceActorID int64, event *proto.EventSeedActor) error {
	if event.Handle == "" {
		return fmt.Errorf("invalid handle")
	}

	if _, exists := h.HandleToID[event.Handle]; exists {
		return fmt.Errorf("handle %q already exists", event.Handle)
	}

	if _, exists := h.IDToHandle[sourceActorID]; exists {
		return fmt.Errorf("actor already has an handle")
	}

	h.HandleToID[event.Handle] = sourceActorID
	h.IDToHandle[sourceActorID] = event.Handle

	return nil
}

func (s *SpaceValidation) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		return s.Handles.Process(sourceActorID, v.SeedActor)
	case *proto.Event_Permission:
		return s.Permission.Process(sourceActorID, v.Permission)
	case *proto.Event_SeedPlayer:
		if s.Permission.Actors[sourceActorID] == PermissionOrga {
			return fmt.Errorf("not authorized: orga not authorized to create players")
		}

		actorID, exists := s.Handles.HandleToID[v.SeedPlayer.Handle]
		if !exists {
			return fmt.Errorf("not authorized: actor does not exist")
		}

		if sourceActorID != actorID {
			return fmt.Errorf("not authorized: missing permission")
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
		if sourceActorID != player.ActorID && s.Permission.Actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		return nil

	case *proto.Event_PlayerCharacter:
		player, exists := s.PlayersIDs[v.PlayerCharacter.PlayerId]
		if !exists {
			return fmt.Errorf("player does not exist")
		}

		if sourceActorID != player.ActorID && s.Permission.Actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized")
		}

		if character, exists := s.CharacterIDs[v.PlayerCharacter.CharacterId]; exists && character.PlayerID != v.PlayerCharacter.PlayerId {
			return fmt.Errorf("character already exists")
		}

		s.CharacterIDs[v.PlayerCharacter.CharacterId] = struct{ PlayerID string }{v.PlayerCharacter.PlayerId}

		return nil
	case *proto.Event_DeleteCharacter:
		if s.Permission.Actors[sourceActorID] != PermissionRoot {
			return fmt.Errorf("not authorized to perform that action")
		}

		_, exists := s.CharacterIDs[v.DeleteCharacter.CharacterId]
		if !exists {
			return fmt.Errorf("character does not exist")
		}

		delete(s.CharacterIDs, v.DeleteCharacter.CharacterId)

		return nil

	case *proto.Event_DeletePlayer:
		if s.Permission.Actors[sourceActorID] != PermissionRoot {
			return fmt.Errorf("not authorized to perform that action")
		}

		_, exists := s.PlayersIDs[v.DeletePlayer.PlayerId]
		if !exists {
			return fmt.Errorf("player does not exist")
		}

		delete(s.PlayersIDs, v.DeletePlayer.PlayerId)

		for characterID, character := range s.CharacterIDs {
			if character.PlayerID == v.DeletePlayer.PlayerId {
				delete(s.CharacterIDs, characterID)
			}
		}

		return nil
	case *proto.Event_Reset_:
		if s.Permission.Actors[sourceActorID] != PermissionRoot {
			return fmt.Errorf("not authorized to perform that action")
		}

		return nil

	case *proto.Event_PlayerCharacterOrgaEdit:
		if s.Permission.Actors[sourceActorID] != PermissionOrga {
			return fmt.Errorf("not authorized to perform that action")
		}

		_, exists := s.CharacterIDs[v.PlayerCharacterOrgaEdit.CharacterId]
		if !exists {
			return fmt.Errorf("character does not exist")
		}

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}
}

type SpacePlayer struct {
	Handle       string
	ActorID      int64
	Events       []*proto.Event
	PlayerIDs    map[string]struct{}
	CharacterIDs map[string]struct {
		PlayerID string
	}
}

func NewSpacePlayer(actorID int64) *SpacePlayer {
	return &SpacePlayer{
		ActorID:      actorID,
		PlayerIDs:    map[string]struct{}{},
		CharacterIDs: map[string]struct{ PlayerID string }{},
	}
}

func (s *SpacePlayer) GetEvents() []*proto.Event {
	return s.Events
}

func (s *SpacePlayer) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedActor:
		if sourceActorID == s.ActorID {
			s.Handle = v.SeedActor.Handle
			s.Events = append(s.Events, event)
		}

		return nil

	case *proto.Event_SeedPlayer:
		if s.Handle == v.SeedPlayer.Handle {
			s.Events = append(s.Events, event)
			s.PlayerIDs[v.SeedPlayer.PlayerId] = struct{}{}
		}

		return nil
	case *proto.Event_PlayerPerson:
		if _, exists := s.PlayerIDs[v.PlayerPerson.PlayerId]; exists {
			s.Events = append(s.Events, event)
		}

		return nil
	case *proto.Event_PlayerCharacter:
		if _, exists := s.PlayerIDs[v.PlayerCharacter.PlayerId]; exists {
			s.Events = append(s.Events, event)
			s.CharacterIDs[v.PlayerCharacter.CharacterId] = struct{ PlayerID string }{
				v.PlayerCharacter.PlayerId,
			}

		}

		return nil
	case *proto.Event_Permission:
		return nil
	case *proto.Event_Reset_:
		s.Events = append(s.Events, event)

		return nil

	case *proto.Event_DeleteCharacter:
		if _, exists := s.CharacterIDs[v.DeleteCharacter.CharacterId]; exists {
			s.Events = append(s.Events, event)

			delete(s.CharacterIDs, v.DeleteCharacter.CharacterId)
		}

		return nil
	case *proto.Event_DeletePlayer:
		if _, exists := s.PlayerIDs[v.DeletePlayer.PlayerId]; exists {
			s.Events = append(s.Events, event)

			delete(s.PlayerIDs, v.DeletePlayer.PlayerId)

			for characterID, character := range s.CharacterIDs {
				if character.PlayerID == v.DeletePlayer.PlayerId {
					delete(s.CharacterIDs, characterID)
				}
			}
		}

		return nil

	case *proto.Event_PlayerCharacterOrgaEdit:
		if _, exists := s.CharacterIDs[v.PlayerCharacterOrgaEdit.CharacterId]; exists {
			s.Events = append(s.Events, event)
		}

		return nil

	default:
		return fmt.Errorf("event %v not handled", v)
	}

}

type ProjectionSpace interface {
	Process(sourceActorID int64, event *proto.Event) error
	GetEvents() []*proto.Event
}

type SpaceOrga struct {
	ActorID int64
	Events  []*proto.Event
}

func NewSpaceOrga(actorID int64) *SpaceOrga {
	return &SpaceOrga{
		ActorID: actorID,
	}
}

func (s *SpaceOrga) GetEvents() []*proto.Event {
	return s.Events
}

func (s *SpaceOrga) Process(sourceActorID int64, event *proto.Event) error {
	switch v := event.Msg.(type) {
	case *proto.Event_SeedPlayer, *proto.Event_PlayerPerson,
		*proto.Event_PlayerCharacter, *proto.Event_SeedActor,
		*proto.Event_Permission, *proto.Event_Reset_,
		*proto.Event_DeleteCharacter, *proto.Event_DeletePlayer, *proto.Event_PlayerCharacterOrgaEdit:
		s.Events = append(s.Events, event)

		return nil
	default:
		return fmt.Errorf("event %v not handled", v)
	}

}
