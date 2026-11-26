package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The test binary runs in go/bench/verify.
const (
	laneRoot        = "../.."
	conformanceRoot = "../../../bench/conformance"
)

// captureStdout runs fn with os.Stdout redirected and returns what it printed.
func captureStdout(t *testing.T, fn func() int) (string, int) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = writer
	printed := make(chan string)
	go func() {
		raw, _ := io.ReadAll(reader)
		printed <- string(raw)
	}()
	code := fn()
	writer.Close()
	os.Stdout = saved
	return <-printed, code
}

func TestEveryLaneTaskResolves(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(laneRoot, "bench", "tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parsed manifest
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	out, code := captureStdout(t, func() int { return run([]string{"--root", laneRoot}) })
	if code != 0 {
		t.Fatalf("verify exit = %d:\n%s", code, out)
	}
	if ok := strings.Count(out, ": OK (from "); ok != len(parsed.Tasks) {
		t.Errorf("%d OK lines for %d tasks", ok, len(parsed.Tasks))
	}
}

// The verifier's stdout on bench/conformance is a byte-for-byte contract shared
// by all six lane verifiers; the go CI job checks it here.
func TestConformanceOutputIsByteIdentical(t *testing.T) {
	want, err := os.ReadFile(filepath.Join(conformanceRoot, "expected.txt"))
	if err != nil {
		t.Fatal(err)
	}
	out, code := captureStdout(t, func() int { return run([]string{"--root", conformanceRoot}) })
	if code != 1 {
		t.Errorf("conformance exit = %d, want 1 (it carries failing cases by design)", code)
	}
	if out != string(want) {
		t.Errorf("conformance output differs from expected.txt:\n%s", out)
	}
}

func TestMissingManifestFails(t *testing.T) {
	_, code := captureStdout(t, func() int { return run([]string{"--root", t.TempDir()}) })
	if code != 1 {
		t.Errorf("exit without tasks.json = %d, want 1", code)
	}
}

func TestSummarizeCapsLongNeedles(t *testing.T) {
	long := strings.Repeat("x", 90)
	if got := summarize(long); len(got) != 80 || !strings.HasSuffix(got, "...") {
		t.Errorf("summarize = %q", got)
	}
	if got := summarize("short"); got != "short" {
		t.Errorf("summarize short = %q", got)
	}
}

func TestLintPassesOnTheLane(t *testing.T) {
	if testing.Short() {
		t.Skip("runs go build, go vet, go list and gofmt over the lane")
	}
	out, code := captureStdout(t, func() int { return run([]string{"--lint", "--root", laneRoot}) })
	if code != 0 {
		t.Fatalf("lint exit = %d:\n%s", code, out)
	}
	if !strings.Contains(out, "module specifier(s) resolve") {
		t.Errorf("lint did not report the specifier check:\n%s", out)
	}
}

// The specifier guard must fail on each kind of broken specifier.
func TestSpecifierGuardBites(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":  "module example.test/bite\n\ngo 1.23\n",
		"good.go": "package bite\n\nimport _ \"strings\"\n",
		"bad.go": "package bite\n\n" +
			"import _ \"example.test/bite/nosuch\"\n\n" +
			"//go:generate go run example.test/bite/nogen -out x.go\n\n" +
			"// see atelier.example/lane/nosuch for nothing\n\n" +
			"var text = \"//go:embed not-a-directive.txt\"\n\n" +
			"//go:embed missing.txt\nvar embedded string\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	found, err := collectSpecifiers(root)
	if err != nil {
		t.Fatal(err)
	}
	if summary := specifierSummary(found); summary != "2 import, 1 go:generate, 1 go:embed, 1 comment, 0 go.mod" {
		t.Errorf("collected %s", summary)
	}
	failures := checkSpecifiers(root, found)
	for _, want := range []string{"example.test/bite/nosuch", "example.test/bite/nogen", "atelier.example/lane/nosuch", "missing.txt"} {
		hit := false
		for _, failure := range failures {
			hit = hit || strings.Contains(failure, want)
		}
		if !hit {
			t.Errorf("no failure names %s: %v", want, failures)
		}
	}
	if len(failures) != 4 {
		t.Errorf("%d failures, want 4: %v", len(failures), failures)
	}
}

func TestWithoutMemberKeepsLowercaseSegments(t *testing.T) {
	cases := map[string]string{
		"atelier.example/lane/core/money.Money": "atelier.example/lane/core/money",
		"atelier.example/yamlish.v2":            "atelier.example/yamlish.v2",
		"atelier.example/lane":                  "atelier.example/lane",
	}
	for in, want := range cases {
		if got := withoutMember(in); got != want {
			t.Errorf("withoutMember(%q) = %q, want %q", in, got, want)
		}
	}
}
