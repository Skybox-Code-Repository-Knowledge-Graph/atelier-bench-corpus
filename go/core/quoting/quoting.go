// Package quoting prices a repair before it is accepted: a quote is a list of
// lines. Line is sealed the way the workshop package's Stage is, by an
// unexported sealed method, and the two method sets are spelled alike; still
// no quote line is a Stage and no stage is a Line, because an unexported
// method name belongs to the package that declares it.
package quoting

import "fmt"

// Line is one priced line of a quote.
type Line interface {
	Caption() string
	sealed()
}

var (
	_ Line = LabourLine{}
	_ Line = PartLine{}
)

// LabourLine bills bench hours.
type LabourLine struct {
	Hours int
}

// Caption describes the line.
func (l LabourLine) Caption() string { return fmt.Sprintf("labour, %d h", l.Hours) }

func (LabourLine) sealed() {}

// PartLine bills one part.
type PartLine struct {
	SKU string
}

// Caption describes the line.
func (p PartLine) Caption() string { return "part " + p.SKU }

func (PartLine) sealed() {}

// Lines is a quote of bench hours and one part.
func Lines(hours int, sku string) []Line {
	return []Line{LabourLine{Hours: hours}, PartLine{SKU: sku}}
}
