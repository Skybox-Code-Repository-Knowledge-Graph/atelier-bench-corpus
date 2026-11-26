package tests

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"slices"
	"testing"

	"atelier.example/lane/core/quoting"
	"atelier.example/lane/core/workshop"
)

func benchTicket() workshop.Ticket {
	return workshop.Ticket{
		Intake:    workshop.Intake{Labels: workshop.Labels{Tags: []string{"laptop", "rush"}}, Received: "counter"},
		Diagnosis: workshop.Diagnosis{Finding: "cracked hinge"},
		Number:    7,
	}
}

func TestTicketSummaryIsTheShallowestPromotion(t *testing.T) {
	ticket := benchTicket()
	if got := ticket.Headline(); got != "#7 cracked hinge" {
		t.Errorf("Headline = %q, want the depth-one Diagnosis summary", got)
	}
	if got := ticket.Tagline(); got != "#7 laptop, rush" {
		t.Errorf("Tagline = %q, want the intake tags through the explicit path", got)
	}
	if got := ticket.Intake.Summary(); got != "laptop, rush" {
		t.Errorf("Intake.Summary = %q, want the tags, promoted inside Intake", got)
	}
}

func TestAuditedSenderDelegatesChannelToTheEmbeddedSender(t *testing.T) {
	for _, tc := range []struct {
		wrapped workshop.Sender
		sent    string
		trail   string
	}{
		{workshop.SMSSender{Number: "+32 470 00 00 09"}, "sms to +32 470 00 00 09: ready", "sms: ready"},
		{workshop.MailSender{Address: "grace@example.test"}, "mail to grace@example.test: ready", "mail: ready"},
	} {
		audited := &workshop.AuditedSender{Sender: tc.wrapped}
		var sender workshop.Sender = audited
		if got := sender.Send("ready"); got != tc.sent {
			t.Errorf("Send = %q, want %q", got, tc.sent)
		}
		if len(audited.Trail) != 1 || audited.Trail[0] != tc.trail {
			t.Errorf("Trail = %v, want [%s]", audited.Trail, tc.trail)
		}
	}
}

func TestStagesAreSealedToTheirPackage(t *testing.T) {
	captions := []string{}
	for _, stage := range workshop.Stages("Grace") {
		captions = append(captions, stage.Caption())
	}
	want := []string{"received at the counter", "on the bench with Grace", "returned to the customer"}
	if !slices.Equal(captions, want) {
		t.Errorf("captions = %v, want %v", captions, want)
	}
	for _, line := range quoting.Lines(2, "FAN-A1") {
		var value any = line
		if _, isStage := value.(workshop.Stage); isStage {
			t.Errorf("%T satisfies workshop.Stage, but its sealed method belongs to package quoting", line)
		}
	}
}

func TestQuoteLinesCaptionThemselves(t *testing.T) {
	captions := []string{}
	for _, line := range quoting.Lines(2, "FAN-A1") {
		captions = append(captions, line.Caption())
	}
	if !slices.Equal(captions, []string{"labour, 2 h", "part FAN-A1"}) {
		t.Errorf("captions = %v", captions)
	}
}

func TestSpoolDirFollowsTheFileNameConstraint(t *testing.T) {
	want := map[string]string{"linux": "/var/spool/atelier", "darwin": "/private/var/spool/atelier"}[runtime.GOOS]
	if want == "" {
		want = "spool"
	}
	if got := workshop.SpoolDir(); got != want {
		t.Errorf("SpoolDir on %s = %q, want %q", runtime.GOOS, got, want)
	}
}

func TestCausesWalksBothUnwrapShapes(t *testing.T) {
	inner := errors.New("hinge out of stock")
	single := fmt.Errorf("order 7: %w", inner)
	if got := workshop.Causes(single); !slices.Equal(got, []string{"order 7: hinge out of stock", "hinge out of stock"}) {
		t.Errorf("single = %v", got)
	}
	joined := errors.Join(single, errors.New("no technician"))
	want := []string{"order 7: hinge out of stock\nno technician", "order 7: hinge out of stock", "hinge out of stock", "no technician"}
	if got := workshop.Causes(joined); !slices.Equal(got, want) {
		t.Errorf("joined = %q", got)
	}
}

func TestTicketCardFlattensTheEmbeddedContact(t *testing.T) {
	encoded, err := json.Marshal(workshop.Card(benchTicket(), "+32 470 00 00 09", workshop.OnBench{Technician: "Grace"}))
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	if body["phone"] != "+32 470 00 00 09" {
		t.Errorf("phone = %v in %s: the embedded Contact's field should sit at the top level", body["phone"], encoded)
	}
	if body["number"] != float64(7) || body["stage"] != "on the bench with Grace" {
		t.Errorf("card = %s", encoded)
	}
}
