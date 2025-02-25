package main

import (
	"fmt"

	"github.com/jmoiron/sqlx"
)

func Run(db *sqlx.DB) error {
	space := NewSpaceValidation()

	records, err := GetEvents(db, -1, EventRecordStatusAll)
	if err != nil {
		return fmt.Errorf("get events: %w", err)
	}

	toUpdate := map[int64]EventRecordStatus{}

	for _, record := range records {
		err := space.Process(record.SourceActorID, record.Event)
		if err != nil && record.Status&(EventRecordStatusPending|EventRecordStatusRejected) != 0 {
			return fmt.Errorf(
				"corrupted state: event %d %+v has status %v. Process returned %w",
				record.Ts,
				record.Event,
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

		if newStatus != record.Status {
			toUpdate[record.Ts] = newStatus
		}
	}

	for ts, status := range toUpdate {
		err = UpdateEventStatus(db, ts, status)
		if err != nil {
			return fmt.Errorf("updating event %d to status %v: %w", ts, status, err)
		}
	}

	return nil
}
