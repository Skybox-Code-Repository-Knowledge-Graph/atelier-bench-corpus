package main

import (
	"bytes"
	"strings"
	"testing"
)

func runCommand(args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestSeedPrintsTheSharedSummaryFirst(t *testing.T) {
	code, out, _ := runCommand("seed")
	if code != 0 {
		t.Fatalf("seed exit = %d", code)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if lines[0] != "seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c" {
		t.Errorf("summary = %q", lines[0])
	}
	// 1 summary + 16 metrics + 1 rule tally + 16 service rows.
	if len(lines) != 34 {
		t.Errorf("seed printed %d lines, want 34", len(lines))
	}
	if !strings.Contains(out, "rules: 48/48 satisfied\n") || !strings.Contains(out, "service warranty-claim: claims = 1.00") {
		t.Errorf("seed output lacks the rule tally or the service rows:\n%s", out)
	}
}

func TestEveryConsoleVerbDispatches(t *testing.T) {
	if code, out, _ := runCommand("report", "cash-flow"); code != 0 || out == "" {
		t.Errorf("report cash-flow = %d, %q", code, out)
	}
	if code, _, errOut := runCommand("report"); code != 1 || !strings.Contains(errOut, "report needs a slug") {
		t.Errorf("report without a slug = %d, %q", code, errOut)
	}
	if code, _, errOut := runCommand("report", "no-such-report"); code != 1 || !strings.Contains(errOut, "no-such-report") {
		t.Errorf("unknown report = %d, %q", code, errOut)
	}
	if code, out, _ := runCommand("export"); code != 0 || !strings.Contains(out, "calculator") {
		t.Errorf("export = %d, %q", code, out)
	}
	if code, out, _ := runCommand("recalculate"); code != 0 || out == "" {
		t.Errorf("recalculate = %d, %q", code, out)
	}
	if code, _, errOut := runCommand("nope"); code != 1 || !strings.Contains(errOut, `unknown command "nope"`) {
		t.Errorf("unknown verb = %d, %q", code, errOut)
	}
	if code, out, _ := runCommand(); code != 2 || out != "usage: atelier <seed|export-report|recalculate-inventory|report|export|recalculate|jobs>\n" {
		t.Errorf("no verb = %d, %q", code, out)
	}
}

// The two shared verbs run the same operations as report / recalculate and
// print values that come from the seed: the cash-flow report's outstanding
// row is the seeded revenue (58325 cents), and two of the four seeded parts
// sit below their reorder level.
// The jobs verb is the application caller of the callback, channel and
// goroutine job shapes and of SafeRun: 4 seeded orders, 1 of them completed,
// three goroutine workers handling all 4 each.
func TestJobsVerbRunsTheThreeJobShapes(t *testing.T) {
	code, out, _ := runCommand("jobs")
	want := "job callback: 4 handled\njob channel: 1 handled\njob goroutines x3: 12 handled\n"
	if code != 0 || out != want {
		t.Errorf("jobs = %d, %q, want %q", code, out, want)
	}
}

func TestSharedVerbsPrintSeedValues(t *testing.T) {
	code, out, _ := runCommand("export-report", "cash-flow")
	if code != 0 || !strings.Contains(out, `{"Label":"outstanding","Value":58325,"Cents":58325}`) {
		t.Errorf("export-report cash-flow (json by default) = %d, %q", code, out)
	}
	code, out, _ = runCommand("export-report", "cash-flow", "csv")
	if code != 0 || !strings.Contains(out, "outstanding,58325.00\n") {
		t.Errorf("export-report cash-flow csv = %d, %q", code, out)
	}
	if code, _, errOut := runCommand("export-report"); code != 1 || !strings.Contains(errOut, "export-report needs a slug") {
		t.Errorf("export-report without a slug = %d, %q", code, errOut)
	}
	if code, _, errOut := runCommand("export-report", "cash-flow", "docx"); code != 1 || !strings.Contains(errOut, `unknown format "docx"`) {
		t.Errorf("export-report with an unknown format = %d, %q", code, errOut)
	}
	code, out, _ = runCommand("recalculate-inventory")
	if code != 0 || out != "recalculate-inventory: 2 part(s) below reorder level, 2 notice(s), last FAN-A1\n" {
		t.Errorf("recalculate-inventory = %d, %q", code, out)
	}
	if _, legacy, _ := runCommand("recalculate"); legacy != out {
		t.Errorf("recalculate and recalculate-inventory differ: %q vs %q", legacy, out)
	}
}
