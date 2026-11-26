package tests

// These tests reach the files no other test executes: the seed command's
// helpers, the twelve services, the repositories over package-local records,
// the behaviour concerns, driven directly rather than through an embedding
// type, the contract enums and the three
// small models. Each asserts a value, so a wrong file fails here.

import (
	"reflect"
	"strings"
	"testing"

	"atelier.example/lane/app"
	"atelier.example/lane/atelier/concerns"
	"atelier.example/lane/atelier/contracts"
	"atelier.example/lane/atelier/repositories"
	"atelier.example/lane/atelier/rules"
	"atelier.example/lane/atelier/rules/adhoc"
	"atelier.example/lane/atelier/services"
	"atelier.example/lane/core/models"
	brokensyntax "atelier.example/lane/fixtures/broken-syntax"
)

func TestSeedCommandHelpers(t *testing.T) {
	state := app.SeededState()
	if got := app.Summarize(state); got != "seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c" {
		t.Errorf("summary = %q", got)
	}
	if lines := app.MetricLines(state); len(lines) != 16 || !strings.HasPrefix(lines[0], "average-ticket = ") {
		t.Errorf("metric lines = %v", lines)
	}
	if got := app.RuleLine(state); got != "rules: 48/48 satisfied" {
		t.Errorf("rule line = %q", got)
	}
	if got := app.SatisfiedRules(state.Data); got != 48 {
		t.Errorf("satisfied rules = %d, want 48", got)
	}
}

// SatisfiedBy is constrained by the structural RuleLike, so both rule
// families pass without conversion: the 24 adhoc values directly, the 48
// registered rules through RuleContract.
func TestSatisfiedByTakesAnyRuleShape(t *testing.T) {
	if got := contracts.SatisfiedBy(adhoc.Rules, seeded()); got != 24 {
		t.Errorf("adhoc rules satisfied = %d, want 24", got)
	}
	if got := contracts.SatisfiedBy(rules.All(), seeded()); got != 48 {
		t.Errorf("registered rules satisfied = %d, want 48", got)
	}
}

func TestEveryServiceRunsOnTheSeed(t *testing.T) {
	want := []string{
		"service backlog: depth = 3.00",
		"service churn-risk: at risk = 0.00",
		"service customer-retention: rate = 0.33",
		"service inventory-turnover: SCR-13 = 0.25",
		"service inventory-turnover: BAT-55 = 2.00",
		"service inventory-turnover: KBD-EU = 0.14",
		"service inventory-turnover: FAN-A1 = 0.50",
		"service order-volume: open = 3.00",
		"service order-volume: completed = 1.00",
		"service part-usage: units = 5.00",
		"service payment-latency: days = 7.00",
		"service profit-margin: ratio = 0.21",
		"service revenue: revenue = 58325.00",
		"service technician-load: mean = 0.00",
		"service throughput: completed = 1.00",
		"service warranty-claim: claims = 1.00",
	}
	got := app.ServiceLines(app.SeededState())
	if !reflect.DeepEqual(got, want) {
		t.Errorf("service lines:\n got %q\nwant %q", got, want)
	}
	all := services.All()
	if len(all) != 12 || all[0].Name() != "backlog" || all[11].Name() != "warranty-claim" {
		t.Errorf("services = %d, first/last %s/%s", len(all), all[0].Name(), all[11].Name())
	}
}

func TestRepositoriesOverRecords(t *testing.T) {
	data := seeded()

	inventory := repositories.NewInventoryRepository([]repositories.Movement{
		{ID: 1, SKU: "SCR-13", Delta: 5},
		{ID: 2, SKU: "SCR-13", Delta: -2},
		{ID: 3, SKU: "BAT-55", Delta: 1},
	})
	if inventory.Count() != 3 || len(inventory.All()) != 3 || inventory.NetFor("SCR-13") != 3 {
		t.Errorf("inventory = %d records, net %d", inventory.Count(), inventory.NetFor("SCR-13"))
	}
	if movement, found := inventory.Find(2); !found || movement.Delta != -2 {
		t.Errorf("find movement 2 = %v, %v", movement, found)
	}
	if _, found := inventory.Find(9); found {
		t.Error("movement 9 should not exist")
	}

	payments := repositories.NewPaymentRepository([]repositories.Payment{{ID: 1, InvoiceID: 1, Cents: 1500}, {ID: 2, InvoiceID: 1, Cents: 250}})
	if payments.Count() != 2 || len(payments.All()) != 2 || payments.SettledCents() != 1750 {
		t.Errorf("payments settled = %d", payments.SettledCents())
	}
	if _, found := payments.Find(2); !found {
		t.Error("payment 2 should exist")
	}
	if _, found := payments.Find(9); found {
		t.Error("payment 9 should not exist")
	}

	invoices := repositories.NewInvoiceRepository(data.Invoices)
	if invoices.Count() != len(data.Invoices) || len(invoices.All()) != len(data.Invoices) {
		t.Errorf("invoices = %d", invoices.Count())
	}
	unpaid := 0
	for _, invoice := range data.Invoices {
		if !invoice.Paid {
			unpaid++
		}
	}
	if len(invoices.Unpaid()) != unpaid {
		t.Errorf("unpaid = %d, want %d", len(invoices.Unpaid()), unpaid)
	}
	if _, found := invoices.Find(data.Invoices[0].ID); !found {
		t.Error("the first invoice should be found")
	}
	if _, found := invoices.Find(-1); found {
		t.Error("invoice -1 should not exist")
	}

	parts := repositories.NewPartRepository(data.Parts)
	if part, found := parts.BySKU("BAT-55"); !found || part.SKU != "BAT-55" {
		t.Errorf("part BAT-55 = %v, %v", part, found)
	}
	if _, found := parts.BySKU("NOPE"); found {
		t.Error("part NOPE should not exist")
	}
	if _, found := parts.Find(data.Parts[0].ID); !found || parts.Count() != 4 || len(parts.All()) != 4 {
		t.Errorf("parts = %d", parts.Count())
	}
	if _, found := parts.Find(-1); found {
		t.Error("part -1 should not exist")
	}

	technicians := repositories.NewTechnicianRepository(data.Technicians)
	if technicians.Count() != len(data.Technicians) || len(technicians.All()) != len(data.Technicians) {
		t.Errorf("technicians = %d", technicians.Count())
	}
	if len(technicians.Available()) != len(data.Technicians) {
		t.Errorf("available = %d of %d; the seed books no slot", len(technicians.Available()), len(data.Technicians))
	}
	if _, found := technicians.Find(data.Technicians[0].ID); !found {
		t.Error("the first technician should be found")
	}
	if _, found := technicians.Find(-1); found {
		t.Error("technician -1 should not exist")
	}
}

func TestConcernsOnTheirOwn(t *testing.T) {
	var logging concerns.HasLogging
	logging.Log("opened")
	logging.Log("closed")
	if logging.LogCount() != 2 || len(logging.Logged()) != 2 || logging.Describe() != "2 line(s)" {
		t.Errorf("logging = %v", logging.Logged())
	}

	var metadata concerns.HasMetadata
	metadata.SetMeta("owner", "nel")
	metadata.SetMeta("bench", "go")
	if value, found := metadata.Meta("owner"); !found || value != "nel" {
		t.Errorf("meta owner = %q, %v", value, found)
	}
	if _, found := metadata.Meta("missing"); found {
		t.Error("an unset key should not be found")
	}
	if keys := metadata.MetaKeys(); !reflect.DeepEqual(keys, []string{"bench", "owner"}) {
		t.Errorf("meta keys = %v, want sorted", keys)
	}

	if got := (concerns.HasSerialization{}).ToJSON(map[string]int{"orders": 4}); got != `{"orders":4}` {
		t.Errorf("compact json = %s", got)
	}
	if got := (concerns.HasSerialization{Indent: true}).ToJSON(map[string]int{"orders": 4}); got != "{\n  \"orders\": 4\n}" {
		t.Errorf("indented json = %q", got)
	}
	if got := (concerns.HasSerialization{}).ToJSON(make(chan int)); got != "{}" {
		t.Errorf("unencodable value = %s, want {}", got)
	}

	var timestamps concerns.HasTimestamps
	timestamps.Touch()
	if timestamps.Touch() != 2 || timestamps.TouchedAt() != "tick-2" {
		t.Errorf("touched at = %s", timestamps.TouchedAt())
	}

	var validation concerns.HasValidation
	if !validation.IsValid() {
		t.Error("no error yet: valid")
	}
	validation.AddError("no device")
	validation.AddError("no customer")
	if validation.IsValid() || validation.ErrorSummary() != "no device; no customer" {
		t.Errorf("validation = %q", validation.ErrorSummary())
	}
}

func TestContractEnumsName(t *testing.T) {
	if contracts.UnitPercent.String() != "percent" || contracts.UnitDays.String() != "days" {
		t.Errorf("units = %s / %s", contracts.UnitPercent, contracts.UnitDays)
	}
	if contracts.CadenceWeekly.String() != "weekly" || contracts.CadenceMonthly.String() != "monthly" {
		t.Errorf("cadences = %s / %s", contracts.CadenceWeekly, contracts.CadenceMonthly)
	}
}

func TestSmallModels(t *testing.T) {
	label := models.NewLabel(1, 1, "AT-2026-000001")
	if !label.Print() || label.Print() {
		t.Error("a label prints once")
	}

	note := models.NewNote(1, 1, "  screen replaced  ", "nel")
	if note.Body != "screen replaced" || note.IsEmpty() || note.Excerpt() != "screen replaced" {
		t.Errorf("note = %q", note.Body)
	}
	long := models.NewNote(2, 1, strings.Repeat("a", 50), "nel")
	if len(long.Excerpt()) != 40 {
		t.Errorf("excerpt = %d chars, want 40", len(long.Excerpt()))
	}
	if !models.NewNote(3, 1, "   ", "nel").IsEmpty() {
		t.Error("a blank note is empty")
	}

	if !models.NewSignature(1, 1, "Ada Byron").IsValid() || models.NewSignature(2, 1, "").IsValid() {
		t.Error("a signature is valid only when signed")
	}
}

// The broken-syntax package's one compiling file is loaded here too, so the
// package keeps building beside its two tag-gated broken files.
func TestBrokenSyntaxPackageStillBuilds(t *testing.T) {
	if brokensyntax.Marker != "broken-syntax fixtures; do not fix" {
		t.Errorf("marker = %q", brokensyntax.Marker)
	}
}
