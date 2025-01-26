package main

type AgeSegment string

const (
	Below12 AgeSegment = "-12"
	Below18 AgeSegment = "-18"
	Below99 AgeSegment = "-99"
)

type Player struct {
	Firstname string `json:"firstname"`
	Lastname  string `json:"lastname"`
}

type Top struct {
	Players []Player `json:"players"`
}
