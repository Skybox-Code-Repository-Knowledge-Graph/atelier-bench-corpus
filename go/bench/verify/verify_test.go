package main

import (
	"encoding/json"
	"fmt"
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
// by all six lane verifiers; the go CI job checks it here. A copy of go/ on its
// own has no bench/conformance and skips, but never on CI.
func TestConformanceOutputIsByteIdentical(t *testing.T) {
	want, err := os.ReadFile(filepath.Join(conformanceRoot, "expected.txt"))
	if err != nil {
		if os.Getenv("GITHUB_ACTIONS") == "" && os.IsNotExist(err) {
			t.Skipf("no bench/conformance next to this lane: %v", err)
		}
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
	saved := os.Stderr
	devnull, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = devnull
	_, code := captureStdout(t, func() int { return run([]string{"--root", t.TempDir()}) })
	os.Stderr = saved
	devnull.Close()
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
		"bench/tasks.json": `{"tasks": [
			{"id": "a", "expect": {"resolution": "strings#Builder"}},
			{"id": "b", "expect": {"resolution": "example.test/bite/nopkg#Thing"}}]}`,
	}
	if err := os.MkdirAll(filepath.Join(root, "bench"), 0o755); err != nil {
		t.Fatal(err)
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
	if summary := specifierSummary(found); summary != "2 import, 1 go:generate, 1 go:embed, 1 comment, 0 go.mod, 2 tasks.json" {
		t.Errorf("collected %s", summary)
	}
	failures := checkSpecifiers(root, found)
	for _, want := range []string{"example.test/bite/nosuch", "example.test/bite/nogen", "atelier.example/lane/nosuch", "missing.txt", "example.test/bite/nopkg"} {
		hit := false
		for _, failure := range failures {
			hit = hit || strings.Contains(failure, want)
		}
		if !hit {
			t.Errorf("no failure names %s: %v", want, failures)
		}
	}
	if len(failures) != 5 {
		t.Errorf("%d failures, want 5: %v", len(failures), failures)
	}
}

// go.mod require and replace directives are read single-line and in blocks,
// so every module a lockfile pins is a specifier the guard resolves.
func TestGoModBlocksAreRead(t *testing.T) {
	root := t.TempDir()
	gomod := "module example.test/blocks\n\ngo 1.23\n\nrequire example.test/one v1.0.0\n\n" +
		"require (\n\texample.test/two v1.2.0\n\texample.test/three v0.1.0 // indirect\n)\n\n" +
		"replace (\n\texample.test/two => ./two\n)\n"
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte(gomod), 0o644); err != nil {
		t.Fatal(err)
	}
	found, err := goModSpecifiers(filepath.Join(root, "go.mod"), "go.mod")
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, spec := range found {
		got = append(got, spec.value+"@"+spec.where)
	}
	want := "example.test/one@go.mod:5 example.test/two@go.mod:8 example.test/three@go.mod:9 replace example.test/two => ./two@go.mod:13"
	if strings.Join(got, " ") != want {
		t.Errorf("go.mod specifiers = %q, want %q", strings.Join(got, " "), want)
	}
}

// A require line naming a module the offline graph cannot load fails the
// guard, while the in-tree replace target still resolves.
func TestGoModRequireMustResolve(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":       "module example.test/req\n\ngo 1.23\n\nrequire (\n\texample.test/nosuch v1.0.0\n\texample.test/local v0.0.0\n)\n\nreplace example.test/local => ./local\n",
		"main.go":      "package req\n",
		"local/go.mod": "module example.test/local\n\ngo 1.23\n",
	}
	if err := os.MkdirAll(filepath.Join(root, "local"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	found, err := goModSpecifiers(filepath.Join(root, "go.mod"), "go.mod")
	if err != nil {
		t.Fatal(err)
	}
	failures := checkSpecifiers(root, found)
	if len(failures) == 0 || !strings.Contains(failures[0], `require "example.test/nosuch": module does not resolve`) {
		t.Errorf("failures = %v, want example.test/nosuch to fail", failures)
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

// writeLane writes a lane-shaped directory: one source file and a manifest.
func writeLane(t *testing.T, manifestJSON string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "bench"), 0o755); err != nil {
		t.Fatal(err)
	}
	source := "package x\n\nfunc use() {\n\tdata := seed()\n\tdata = seed()\n\t_ = data\n}\n"
	if err := os.WriteFile(filepath.Join(root, "x.go"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bench", "tasks.json"), []byte(manifestJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// repeated_sites is checked for its line count, and the OK line does not
// change with it (the conformance contract counts needles only).
func TestRepeatedSitesLinesAreChecked(t *testing.T) {
	manifest := func(lines int) string {
		return `{"tasks": [{"id": "refs-seed", "surface": "references",
			"from": {"file": "x.go", "needle": "func use() {"},
			"expect": {"exact_count": 2, "known_sites": [],
				"repeated_sites": [{"file": "x.go", "needle": "seed()", "lines": ` + fmt.Sprint(lines) + `}]}}]}`
	}
	out, code := captureStdout(t, func() int { return run([]string{"--root", writeLane(t, manifest(2))}) })
	if code != 0 || out != "refs-seed: OK (from x.go:3 -> 0 expect needles resolved)\n" {
		t.Errorf("right count: exit %d, %q", code, out)
	}
	out, code = captureStdout(t, func() int { return run([]string{"--root", writeLane(t, manifest(3))}) })
	if code != 1 || out != "refs-seed: FAIL x.go repeated needle seed() (found 2 times, lines says 3)\n" {
		t.Errorf("wrong count: exit %d, %q", code, out)
	}
}

// Each broken fixture must fail to parse on its own; one that parses is named.
func TestParseableFixturesAreNamed(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "fixtures", "broken-syntax")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"still_broken.go": "//go:build brokenfixtures\n\npackage brokensyntax\n\ntype S struct {\n\tslots [8]bool\n",
		"fixed.go":        "//go:build brokenfixtures\n\npackage brokensyntax\n\ntype T struct{}\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got := parseableFixtures(root, []string{"fixed.go", "still_broken.go"}); len(got) != 1 || got[0] != "fixed.go" {
		t.Errorf("parseable fixtures = %v, want [fixed.go]", got)
	}
	if got := parseableFixtures(laneRoot, []string{"bad_receiver.go", "unclosed_struct.go"}); len(got) != 0 {
		t.Errorf("the lane's broken fixtures parse: %v", got)
	}
}
