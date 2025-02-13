package main

import "github.com/ebenaum/thekeeper/proto"

type SpaceValidation struct {
	Permission Permission
}

type SpacePlayerProjection struct {
	ActorID int
}

type SpaceOrgaProjection struct {
	ActorID int
}

func Register(eventType proto.EventType)
