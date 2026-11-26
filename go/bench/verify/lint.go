package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// lintDirs are the directories the gofmt sweep covers. fixtures/ is NOT among
// them on purpose: gofmt exits 2 on unparseable input, and the broken fixtures
// are unparseable by design.
var lintDirs = []string{"app", "atelier", "bench", "cmd", "core", "internal", "tests", "third_party", "tools"}

// brokenFixtureTag gates the two intentionally invalid files, so the normal
// build never sees them and `go build -tags brokenfixtures` still can.
const brokenFixtureTag = "brokenfixtures"

// runLint is --lint: the whole tree builds, the broken fixtures do not, vet is
// clean and every file is gofmt-formatted.
func runLint(root string) int {
	sources, err := goFiles(root)
	if err != nil {
		fmt.Printf("lint: FAIL (cannot walk %s: %v)\n", root, err)
		return 1
	}

	if output, err := runGo(root, "build", "./..."); err != nil {
		fmt.Printf("lint: FAIL (go build ./... failed)\n%s", output)
		return 1
	}
	fmt.Printf("lint: OK (%d source file(s) build)\n", len(sources))

	fixtures, err := brokenFixtures(root)
	if err != nil || len(fixtures) == 0 {
		fmt.Printf("lint: FAIL (missing %s)\n", filepath.Join(root, "fixtures", "broken-syntax"))
		return 1
	}
	if _, err := runGo(root, "build", "-tags", brokenFixtureTag, "./fixtures/broken-syntax/"); err == nil {
		fmt.Printf("lint: FAIL (fixtures/broken-syntax compiled; it must not)\n")
		return 1
	}
	// The package build fails on its first broken file, so it cannot show that
	// EACH fixture is still broken: every file must also fail to parse alone.
	if parsed := parseableFixtures(root, fixtures); len(parsed) > 0 {
		for _, name := range parsed {
			fmt.Printf("lint: PARSES fixtures/broken-syntax/%s\n", name)
		}
		fmt.Printf("lint: FAIL (%d broken fixture(s) parse; each must not)\n", len(parsed))
		return 1
	}
	fmt.Printf("lint: OK (%d broken fixture(s) still refuse to compile, each one fails to parse)\n", len(fixtures))

	if output, err := runGo(root, "vet", "./..."); err != nil {
		fmt.Printf("lint: FAIL (go vet ./... reported findings)\n%s", output)
		return 1
	}
	fmt.Println("lint: OK (go vet clean)")

	specifiers, err := collectSpecifiers(root)
	if err != nil {
		fmt.Printf("lint: FAIL (cannot collect module specifiers: %v)\n", err)
		return 1
	}
	if failures := checkSpecifiers(root, specifiers); len(failures) > 0 {
		for _, failure := range failures {
			fmt.Printf("lint: UNRESOLVED %s\n", failure)
		}
		fmt.Printf("lint: FAIL (%d of %d module specifier(s) do not resolve)\n", len(failures), len(specifiers))
		return 1
	}
	fmt.Printf("lint: OK (%d module specifier(s) resolve: %s)\n", len(specifiers), specifierSummary(specifiers))

	unformatted, err := gofmtDrift(root)
	if err != nil {
		fmt.Printf("lint: FAIL (gofmt could not run: %v)\n", err)
		return 1
	}
	if len(unformatted) > 0 {
		for _, path := range unformatted {
			fmt.Printf("lint: DRIFT %s\n", path)
		}
		fmt.Printf("lint: FAIL (gofmt: %d file(s) not formatted)\n", len(unformatted))
		return 1
	}
	fmt.Printf("lint: OK (gofmt clean over %d file(s))\n", len(sources))
	return 0
}

// runGo runs one go subcommand in the lane root and returns its combined output.
func runGo(root string, args ...string) (string, error) {
	command := exec.Command("go", args...)
	command.Dir = root
	command.Env = append(os.Environ(), "GOFLAGS=")
	output, err := command.CombinedOutput()
	return string(output), err
}

// goFiles lists every .go file under the linted directories, sorted.
func goFiles(root string) ([]string, error) {
	found := []string{}
	for _, dir := range lintDirs {
		base := filepath.Join(root, dir)
		if _, err := os.Stat(base); err != nil {
			continue
		}
		err := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && strings.HasSuffix(path, ".go") {
				found = append(found, path)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return found, nil
}

// brokenFixtures lists the intentionally invalid files, which are never fixed.
func brokenFixtures(root string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(root, "fixtures", "broken-syntax"))
	if err != nil {
		return nil, err
	}
	found := []string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || entry.Name() == "doc.go" {
			continue
		}
		found = append(found, entry.Name())
	}
	return found, nil
}

// parseableFixtures returns the broken fixtures that parse on their own.
func parseableFixtures(root string, fixtures []string) []string {
	parsed := []string{}
	for _, name := range fixtures {
		path := filepath.Join(root, "fixtures", "broken-syntax", name)
		if _, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.AllErrors); err == nil {
			parsed = append(parsed, name)
		}
	}
	return parsed
}

// gofmtDrift returns the files gofmt would rewrite.
func gofmtDrift(root string) ([]string, error) {
	present := []string{}
	for _, dir := range lintDirs {
		if _, err := os.Stat(filepath.Join(root, dir)); err == nil {
			present = append(present, dir)
		}
	}
	command := exec.Command("gofmt", append([]string{"-l"}, present...)...)
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
	}
	drift := []string{}
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if strings.TrimSpace(line) != "" {
			drift = append(drift, line)
		}
	}
	return drift, nil
}
