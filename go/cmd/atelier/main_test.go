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
	if code, out, _ := runCommand(); code != 2 || !strings.HasPrefix(out, "usage: atelier") {
		t.Errorf("no verb = %d, %q", code, out)
	}
}
