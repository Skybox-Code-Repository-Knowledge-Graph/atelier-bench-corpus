package main

import (
	"encoding/json"
	"fmt"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// specifier is one module specifier written somewhere in the lane, with the
// place it was written.
type specifier struct {
	kind    string // import, go:generate, go:embed, comment, go.mod, tasks.json
	value   string // import path, package path, embed pattern or module path
	version string // the version a go.mod require line names
	dir     string // go:embed and go:generate file arguments resolve against it; a go.mod's directory
	where   string // file:line, relative to the lane root
}

// commentModulePath matches a path under this lane's module domain written in
// a comment, such as the go:generate target or a doc sentence naming the module.
var commentModulePath = regexp.MustCompile(`atelier\.example/[A-Za-z0-9_./-]*[A-Za-z0-9_]`)

// docLink matches a Go doc link to a package, such as [encoding/json] or
// [atelier.example/lane/core/money.Money]: at least one slash, lowercase path.
var docLink = regexp.MustCompile(`\[([a-z][a-z0-9_.-]*(?:/[a-z0-9_.-]+)+?)(?:\.[A-Z][A-Za-z0-9_]*)*\]`)

// collectSpecifiers lists every module specifier in every .go file under the
// lane root, whatever its build constraint (the broken fixtures, the darwin
// half of the build-tag pair and the separate third_party module included):
// import specs, the package of each `//go:generate go run` directive, each
// `//go:embed` pattern, lane module paths and doc links in comments, the
// require and replace lines of every go.mod, and the package path of every
// `resolution` key in bench/tasks.json (`atelier.example/lane/core/billing#Formatter`).
func collectSpecifiers(root string) ([]specifier, error) {
	found := []specifier{}
	fset := token.NewFileSet()
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		name := info.Name()
		if info.IsDir() {
			if path != root && (strings.HasPrefix(name, ".") || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		relative, _ := filepath.Rel(root, path)
		relative = filepath.ToSlash(relative)
		switch {
		case strings.HasSuffix(name, ".go"):
			// ImportsOnly stops before the first declaration, so a file that is
			// broken further down (the parse-negative fixtures) still yields its
			// import block; a broken import block is itself a failure.
			parsed, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
			if err != nil {
				return fmt.Errorf("%s: import block does not parse: %v", relative, err)
			}
			for _, spec := range parsed.Imports {
				value, err := strconv.Unquote(spec.Path.Value)
				if err != nil {
					return fmt.Errorf("%s: import path %s", relative, spec.Path.Value)
				}
				found = append(found, specifier{kind: "import", value: value, where: fmt.Sprintf("%s:%d", relative, fset.Position(spec.Pos()).Line)})
			}
			comments, err := commentSpecifiers(path, relative)
			if err != nil {
				return err
			}
			found = append(found, comments...)
		case name == "go.mod":
			mods, err := goModSpecifiers(path, relative)
			if err != nil {
				return err
			}
			found = append(found, mods...)
		case relative == "bench/tasks.json":
			keys, err := resolutionSpecifiers(path, relative)
			if err != nil {
				return err
			}
			found = append(found, keys...)
		}
		return nil
	})
	return found, err
}

// commentSpecifiers reads every comment of one file with go/scanner, which
// tokenises without parsing: the directives after the import block and the
// comments of files that do not parse are read too, and a "//" inside a string
// literal is never taken for a comment.
func commentSpecifiers(path string, relative string) ([]specifier, error) {
	source, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	found := []specifier{}
	dir := filepath.Dir(path)
	fset := token.NewFileSet()
	file := fset.AddFile(path, -1, len(source))
	var tokens scanner.Scanner
	tokens.Init(file, source, func(token.Position, string) {}, scanner.ScanComments)
	for {
		position, kind, literal := tokens.Scan()
		if kind == token.EOF {
			break
		}
		if kind != token.COMMENT {
			continue
		}
		first := fset.Position(position).Line
		for offset, comment := range strings.Split(literal, "\n") {
			found = append(found, commentLine(strings.TrimSpace(comment), dir, fmt.Sprintf("%s:%d", relative, first+offset))...)
		}
	}
	return found, nil
}

// commentLine reads the specifiers of one comment line.
func commentLine(comment string, dir string, where string) []specifier {
	found := []specifier{}
	switch {
	case strings.HasPrefix(comment, "//go:generate "):
		fields := strings.Fields(strings.TrimPrefix(comment, "//go:generate "))
		if len(fields) >= 3 && fields[0] == "go" && fields[1] == "run" {
			for _, argument := range fields[2:] {
				if !strings.HasPrefix(argument, "-") {
					return append(found, specifier{kind: "go:generate", value: argument, dir: dir, where: where})
				}
			}
		}
		return found
	case strings.HasPrefix(comment, "//go:embed "):
		for _, pattern := range strings.Fields(strings.TrimPrefix(comment, "//go:embed ")) {
			if unquoted, err := strconv.Unquote(pattern); err == nil {
				pattern = unquoted
			}
			found = append(found, specifier{kind: "go:embed", value: pattern, dir: dir, where: where})
		}
		return found
	}
	for _, match := range commentModulePath.FindAllString(comment, -1) {
		found = append(found, specifier{kind: "comment", value: withoutMember(strings.TrimRight(match, ".")), where: where})
	}
	for _, match := range docLink.FindAllStringSubmatch(comment, -1) {
		if !strings.HasPrefix(match[1], "atelier.example/") {
			found = append(found, specifier{kind: "comment", value: match[1], where: where})
		}
	}
	return found
}

// withoutMember drops a trailing exported member from a doc-link style path,
// so atelier.example/lane/core/money.Money names the package core/money; a
// lowercase suffix such as the .v2 of yamlish.v2 is part of the path and stays.
func withoutMember(path string) string {
	slash := strings.LastIndex(path, "/")
	if dot := strings.Index(path[slash+1:], "."); dot >= 0 {
		rest := path[slash+1+dot+1:]
		if rest != "" && rest[0] >= 'A' && rest[0] <= 'Z' {
			return path[:slash+1+dot]
		}
	}
	return path
}

// goModSpecifiers reads the require and replace directives of one go.mod,
// single-line or grouped in a `require (` / `replace (` block, with any
// trailing `// indirect` comment dropped.
func goModSpecifiers(path string, relative string) ([]specifier, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	found := []specifier{}
	block := ""
	for index, line := range strings.Split(string(raw), "\n") {
		code, _, _ := strings.Cut(line, "//")
		fields := strings.Fields(code)
		where := fmt.Sprintf("%s:%d", relative, index+1)
		switch {
		case len(fields) == 2 && fields[1] == "(":
			block = fields[0]
			continue
		case len(fields) == 1 && fields[0] == ")":
			block = ""
			continue
		case block != "" && len(fields) > 0:
			fields = append([]string{block}, fields...)
		}
		switch {
		case len(fields) >= 3 && fields[0] == "require":
			found = append(found, specifier{kind: "go.mod", value: fields[1], version: fields[2], dir: filepath.Dir(path), where: where})
		case len(fields) >= 4 && fields[0] == "replace" && fields[2] == "=>":
			found = append(found, specifier{kind: "go.mod", value: "replace " + fields[1] + " => " + fields[3], dir: filepath.Dir(path), where: where})
		}
	}
	return found, nil
}

// checkSpecifiers resolves every specifier and returns one line per failure.
// Packages resolve through one `go list -e` from the lane root with the
// module proxy off, so nothing is fetched; a comment path may also name a
// module (`go list -m`); embed patterns must match a file next to their
// directive; a replace target must be a directory whose go.mod declares the
// replaced module.
func checkSpecifiers(root string, found []specifier) []string {
	failures := []string{}
	packages := map[string]bool{}
	for _, spec := range found {
		switch spec.kind {
		case "import", "comment", "tasks.json":
			packages[spec.value] = true
		case "go:generate":
			if !strings.HasSuffix(spec.value, ".go") {
				packages[spec.value] = true
			}
		}
	}
	resolved := listPackages(root, packages)
	for _, spec := range found {
		switch spec.kind {
		case "import", "go:generate", "comment", "tasks.json":
			if spec.kind == "go:generate" && strings.HasSuffix(spec.value, ".go") {
				if _, err := os.Stat(filepath.Join(spec.dir, spec.value)); err != nil {
					failures = append(failures, fmt.Sprintf("%s %s %q: no such file", spec.where, spec.kind, spec.value))
				}
				continue
			}
			problem := resolved[spec.value]
			if problem != "" && spec.kind == "comment" && moduleResolves(root, spec.value) {
				problem = ""
			}
			if problem != "" {
				failures = append(failures, fmt.Sprintf("%s %s %q: %s", spec.where, spec.kind, spec.value, problem))
			}
		case "go:embed":
			matches, err := filepath.Glob(filepath.Join(spec.dir, spec.value))
			if err != nil || len(matches) == 0 {
				failures = append(failures, fmt.Sprintf("%s go:embed %q: matches no file", spec.where, spec.value))
			}
		case "go.mod":
			if strings.HasPrefix(spec.value, "replace ") {
				parts := strings.Fields(spec.value)
				target := filepath.Join(spec.dir, parts[3])
				if module, err := moduleOf(filepath.Join(target, "go.mod")); err != nil || module != parts[1] {
					failures = append(failures, fmt.Sprintf("%s %s: target is not module %s", spec.where, spec.value, parts[1]))
				}
			} else if !moduleResolves(root, spec.value) && !lockedInGoSum(spec.dir, spec.value, spec.version) {
				failures = append(failures, fmt.Sprintf("%s require %q: module does not resolve", spec.where, spec.value))
			}
		}
	}
	return failures
}

// listPackages maps each package path to "" when `go list` resolves it, or
// to the reason it does not.
func listPackages(root string, paths map[string]bool) map[string]string {
	sorted := make([]string, 0, len(paths))
	for path := range paths {
		if path != "C" {
			sorted = append(sorted, path)
		}
	}
	sort.Strings(sorted)
	result := map[string]string{}
	if len(sorted) == 0 {
		return result
	}
	args := append([]string{"list", "-e", "-f", "{{.ImportPath}}\t{{with .Error}}{{.Err}}{{end}}"}, sorted...)
	command := exec.Command("go", args...)
	command.Dir = root
	command.Env = append(os.Environ(), "GOFLAGS=", "GOPROXY=off", "GOWORK=off")
	output, err := command.Output()
	if err != nil {
		for _, path := range sorted {
			result[path] = fmt.Sprintf("go list failed: %v", err)
		}
		return result
	}
	for _, path := range sorted {
		result[path] = "not listed by go list"
	}
	for _, row := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		path, problem, _ := strings.Cut(row, "\t")
		if strings.Contains(problem, "build constraints exclude all Go files") {
			problem = "" // the package exists; every file is behind a tag
		}
		if _, asked := result[path]; asked {
			result[path] = strings.TrimSpace(problem)
		}
	}
	return result
}

// moduleResolves reports whether `go list -m` knows the module path.
func moduleResolves(root string, module string) bool {
	command := exec.Command("go", "list", "-m", module)
	command.Dir = root
	command.Env = append(os.Environ(), "GOFLAGS=", "GOPROXY=off", "GOWORK=off")
	return command.Run() == nil
}

// lockedInGoSum reports whether the go.sum next to the go.mod that requires
// the module records the hash of that version's go.mod. A module the build
// never compiles on the CI platform (gin's alternative JSON backends, behind
// build tags) is never downloaded there, so `go list -m` cannot answer for it
// with the proxy off; the lockfile line is then what pins it, and the go
// command checks that hash whenever it fetches the module.
func lockedInGoSum(dir string, module string, version string) bool {
	raw, err := os.ReadFile(filepath.Join(dir, "go.sum"))
	if err != nil || version == "" {
		return false
	}
	want := module + " " + version + "/go.mod h1:"
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, want) {
			return true
		}
	}
	return false
}

// moduleOf reads the module line of a go.mod.
func moduleOf(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1], nil
		}
	}
	return "", fmt.Errorf("%s declares no module", path)
}

// specifierSummary counts the specifiers by kind, in a fixed order.
func specifierSummary(found []specifier) string {
	counts := map[string]int{}
	for _, spec := range found {
		counts[spec.kind]++
	}
	parts := []string{}
	for _, kind := range []string{"import", "go:generate", "go:embed", "comment", "go.mod", "tasks.json"} {
		parts = append(parts, fmt.Sprintf("%d %s", counts[kind], kind))
	}
	return strings.Join(parts, ", ")
}

// resolutionSpecifiers reads the package path of each `resolution` key, the
// part before `#`, with the manifest line it is written on.
func resolutionSpecifiers(path string, relative string) ([]specifier, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Tasks []struct {
			Expect struct {
				Resolution string `json:"resolution"`
			} `json:"expect"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("%s: %v", relative, err)
	}
	lines := strings.Split(string(raw), "\n")
	found := []specifier{}
	for _, entry := range parsed.Tasks {
		key := entry.Expect.Resolution
		if key == "" {
			continue
		}
		where := relative
		for index, line := range lines {
			if strings.Contains(line, `"resolution": `+strconv.Quote(key)) {
				where = fmt.Sprintf("%s:%d", relative, index+1)
				break
			}
		}
		packagePath, _, _ := strings.Cut(key, "#")
		found = append(found, specifier{kind: "tasks.json", value: packagePath, where: where})
	}
	return found, nil
}
