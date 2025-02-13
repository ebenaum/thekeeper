package main

import (
	"github.com/ebenaum/thekeeper/proto"
)

type Seed struct {
}

func (s *Seed) ValidationSpace(event *proto.EventSeed) {
	a := proto.Events{}
	a.Events[0].Msg.(*proto.Event_Permission)
}
