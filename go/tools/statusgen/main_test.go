package main

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// committed is the file the //go:generate directive in core/support/status.go
// writes; the generator must reproduce it byte for byte.
const committed = "../../core/support/status_labels_gen.go"

func TestMainRegeneratesTheCommittedFile(t *testing.T) {
	want, err := os.ReadFile(committed)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "status_labels_gen.go")
	// main parses the process flags; a fresh set lets the test run repeatedly.
	flag.CommandLine = flag.NewFlagSet("statusgen", flag.ExitOnError)
	os.Args = []string{"statusgen", "-out", out}
	main()
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("statusgen output differs from %s:\n%s", committed, got)
	}
}
