package main

import (
	"bytes"
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
