// Package workshop models a repair ticket on the bench: what the counter and
// the bench record about it, the stages it passes through, the senders that
// notify the customer and the card the counter prints.
package workshop

import "fmt"

// Labels carries the intake tags. Its Summary sits two embedding levels below
// a Ticket.
type Labels struct {
	Tags []string
}

// Summary joins the intake tags.
func (l Labels) Summary() string {
	if len(l.Tags) == 0 {
		return "untagged"
	}
	summary := l.Tags[0]
	for _, tag := range l.Tags[1:] {
		summary += ", " + tag
	}
	return summary
}

// Intake is what the counter records; it embeds Labels.
type Intake struct {
	Labels
	Received string
}

// Diagnosis is what the bench finds. Its Summary sits one embedding level
// below a Ticket.
type Diagnosis struct {
	Finding string
}

// Summary is the bench finding.
func (d Diagnosis) Summary() string {
	return d.Finding
}

// Ticket embeds Intake first and Diagnosis second, and both promote a
// Summary: Diagnosis's at depth one, Labels's at depth two through Intake.
// The shallower one wins whatever the order of the fields, so t.Summary() is
// the bench finding, and the intake tags are reached only by the explicit
// path t.Intake.Labels.
type Ticket struct {
	Intake
	Diagnosis
	Number int
}

// Headline is the line the bench board shows.
func (t Ticket) Headline() string {
	return fmt.Sprintf("#%d %s", t.Number, t.Summary())
}

// Tagline is the line the counter shows.
func (t Ticket) Tagline() string {
	return fmt.Sprintf("#%d %s", t.Number, t.Intake.Labels.Summary())
}

// SpoolDir is where printed tickets queue on this platform; spoolDir has one
// declaration per platform file.
func SpoolDir() string {
	return spoolDir()
}
