package support

import (
	"atelier.example/lane/atelier/concerns"
	"atelier.example/lane/atelier/contracts"
)

// CompositeReport is level THREE: PeriodicReport plus two behaviour structs,
// the audit trail and the metadata map. A report embedding this reaches Slug()
// through four levels of promotion and satisfies CompositeContract and
// AuditableContract at once.
type CompositeReport struct {
	PeriodicReport
	concerns.HasAudit
	concerns.HasMetadata
}

// NewCompositeReport seeds the periodic half; the audit trail starts empty.
func NewCompositeReport(slug string, title string, cadence contracts.Cadence) CompositeReport {
	return CompositeReport{PeriodicReport: NewPeriodicReport(slug, title, cadence)}
}
