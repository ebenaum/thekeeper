package main

import "github.com/ebenaum/thekeeper/proto"

type Permission struct {
	actors map[int64]string
}

func (p Permission) Key() string {
	return "permission"
}

func (p Permission) ValidationSpace(event *proto.EventPermission) {
	p.actors[event.ActorId] = event.Permission
}
