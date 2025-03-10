package main

import (
	"fmt"

	"github.com/ebenaum/thekeeper/proto"
	"github.com/jmoiron/sqlx"
)

type RunEventResult struct {
	Ts     int64             `json:"ts"`
	Status EventRecordStatus `json:"status"`
	Error  string            `json:"error,omitempty"`
}

func Run(db *sqlx.DB, tsResultsToInclude map[int64]bool) ([]RunEventResult, error) {
	space := NewSpaceValidation()

	results := make([]RunEventResult, 0)

	records, err := GetEvents(db, -1, EventRecordStatusAll)
	if err != nil {
		return nil, fmt.Errorf("get events: %w", err)
	}

	toUpdate := map[int64]EventRecordStatus{}

	for _, record := range records {
		err := space.Process(record.SourceActorID, &record.Event)
		if err != nil && record.Status&(EventRecordStatusPending|EventRecordStatusRejected) != 0 {
			return nil, fmt.Errorf(
				"corrupted state: event %d has status %v. Process returned: %w",
				record.Event.Ts,
				record.Status,
				err,
			)
		}

		var newStatus EventRecordStatus

		if err != nil {
			newStatus = EventRecordStatusRejected
		} else {
			newStatus = EventRecordStatusAccepted
		}

		if tsResultsToInclude[record.Event.Ts] {
			result := RunEventResult{
				record.Event.Ts,
				newStatus,
				"",
			}

			if err != nil {
				result.Error = err.Error()
			}

			results = append(results, result)
		}

		if newStatus != record.Status {
			toUpdate[record.Event.Ts] = newStatus
		}
	}

	for ts, status := range toUpdate {
		err = UpdateEventStatus(db, ts, status)
		if err != nil {
			return nil, fmt.Errorf("updating event %d to status %v: %w", ts, status, err)
		}
	}

	return results, nil
}

func FetchEvents(db *sqlx.DB, sourceActorID int64, from int64) ([]*proto.Event, error) {
	space := NewSpacePlayer(sourceActorID)

	records, err := GetEvents(db, -1, EventRecordStatusAccepted)
	if err != nil {
		return nil, fmt.Errorf("get events: %w", err)
	}

	for _, record := range records {
		err := space.Process(record.SourceActorID, &record.Event)
		if err != nil {
			return nil, fmt.Errorf(
				"corrupted state: event %d has status %v. Process returned: %w",
				record.Event.Ts,
				record.Status,
				err,
			)
		}
	}

	var cursor int
	for cursor = range space.Events {
		if space.Events[cursor].Ts > from {
			break
		}
	}

	return space.Events[cursor:], nil
}

func InsertAndCheckEvents(db *sqlx.DB, from int64, sourceActorID int64, newEvents []*proto.Event) ([]RunEventResult, error) {
	tss, err := InsertEvents(db, sourceActorID, newEvents)
	if err != nil {
		return nil, fmt.Errorf("insert events: %w", err)
	}

	tssMap := map[int64]bool{}
	for _, ts := range tss {
		tssMap[ts] = true
	}

	result, err := Run(db, tssMap)
	if err != nil {
		return nil, fmt.Errorf("run: %w", err)
	}

	return result, nil
}
