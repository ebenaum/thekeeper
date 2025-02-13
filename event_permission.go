package main

import (
	"fmt"

	"github.com/ebenaum/thekeeper/proto"
)

const (
	PermissionRoot = "root"
	PermissionOrga = "orga"
)

type Permission struct {
	actors map[int64]string
}

func (p Permission) Process(actorID int64, event *proto.EventPermission) error {
	if p.actors[actorID] != PermissionRoot {
		return fmt.Errorf("not authorized to perform that action")
	}

	p.actors[event.ActorId] = event.Permission

	return nil
}
