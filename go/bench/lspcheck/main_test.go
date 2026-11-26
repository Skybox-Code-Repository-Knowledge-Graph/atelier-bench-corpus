package main

// These tests cover the checker's own logic with recorded reply shapes; none
// starts a language server, so they run in CI where gopls is not installed.

import (
	"bufio"
	"bytes"
	"encoding/json"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestFramesRoundTrip(t *testing.T) {
	var buffer bytes.Buffer
	if err := writeMessage(&buffer, map[string]any{"jsonrpc": "2.0", "id": 1, "result": "ok"}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(buffer.String(), "Content-Length: 38\r\n\r\n") {
		t.Errorf("frame = %q", buffer.String())
	}
	body, err := readMessage(bufio.NewReader(&buffer))
	if err != nil || string(body) != `{"id":1,"jsonrpc":"2.0","result":"ok"}` {
		t.Errorf("read back %q, %v", body, err)
	}
}

func TestPositionFindsTheWordOccurrence(t *testing.T) {
	text := "package x\n\tbase := c.StandardInvoiceCalculator.Calculate(order)\n"
	symbol := "Calculate"
	line, column, err := position(text, "base := c.", &symbol, 0)
	if err != nil || line != 1 || column != 37 {
		t.Errorf("Calculate at %d:%d (%v), want 1:37, not inside StandardInvoiceCalculator", line, column, err)
	}
	if _, _, err := position(text, "nowhere", &symbol, 0); err == nil {
		t.Error("a missing needle must fail")
	}
	if got := utf16Len("é𝄞"); got != 3 {
		t.Errorf("utf16Len = %d, want 3", got)
	}
}

func TestRelPathNamesNoMachineDirectory(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "lane", "go")
	env := paths{goroot: "/toolchain/go", modcache: "/cache/mod"}
	cases := map[string]string{
		fileURI(filepath.Join(root, "core", "money", "money.go")):   "core/money/money.go",
		"file:///toolchain/go/src/net/http/server.go":               "$GOROOT/src/net/http/server.go",
		"file:///cache/mod/github.com/gin-gonic/gin@v1.10.1/gin.go": "$GOMODCACHE/github.com/gin-gonic/gin@v1.10.1/gin.go",
		"file:///elsewhere/x.go":                                    "(outside the lane)/x.go",
	}
	if runtime.GOOS == "windows" {
		t.Skip("POSIX paths")
	}
	for uri, want := range cases {
		if got := relPath(uri, root, env); got != want {
			t.Errorf("relPath(%s) = %s, want %s", uri, got, want)
		}
	}
}

func TestHoverVerdictReadsEveryContentShape(t *testing.T) {
	for _, raw := range []string{
		`{"contents": {"kind": "plaintext", "value": "func Seeded() *Dataset\nChanging these rows changes bench ground truth."}}`,
		`{"contents": "Changing these rows changes bench ground truth."}`,
		`{"contents": ["func Seeded()", {"language": "go", "value": "Changing these rows changes bench ground truth."}]}`,
	} {
		if outcome, _ := hoverVerdict(json.RawMessage(raw), "changes bench ground truth"); outcome != "agrees" {
			t.Errorf("%s -> %s", raw, outcome)
		}
	}
	if outcome, _ := hoverVerdict(json.RawMessage(`{"contents": {"value": "other"}}`), "DO NOT EDIT"); outcome != "disagrees" {
		t.Errorf("a hover without the string = %s", outcome)
	}
	if outcome, _ := hoverVerdict(json.RawMessage(`null`), "x"); outcome != "no answer" {
		t.Errorf("null hover = %s", outcome)
	}
}

func TestDocsymVerdictCountsNestedSymbolsAndMethodNames(t *testing.T) {
	raw := `[{"name": "RepairOrder", "children": [{"name": "ID"}, {"name": "Status"}]}, {"name": "(*RepairOrder).Complete"}]`
	if outcome, detail := docsymVerdict(json.RawMessage(raw), 3, []string{"RepairOrder", "Complete"}); outcome != "agrees" || !strings.HasPrefix(detail, "4 symbols") {
		t.Errorf("%s: %s", outcome, detail)
	}
	if outcome, _ := docsymVerdict(json.RawMessage(raw), 5, nil); outcome != "disagrees" {
		t.Errorf("4 symbols against min 5 = %s", outcome)
	}
	if got := methodName("Money.Times"); got != "Times" {
		t.Errorf("methodName = %s", got)
	}
}

func TestImplementationVerdictSeparatesMissingAndExtra(t *testing.T) {
	if outcome, _ := implementationVerdict([]string{"a.go:3", "b.go:4", "c.go:5"}, []string{"a.go:3", "b.go:4"}, []string{"c.go:5"}); outcome != "agrees" {
		t.Errorf("optional extra = %s", outcome)
	}
	outcome, detail := implementationVerdict([]string{"a.go:3", "z.go:9"}, []string{"a.go:3", "b.go:4"}, nil)
	if outcome != "disagrees" || !strings.Contains(detail, "missing [b.go:4]") || !strings.Contains(detail, "not in the key [z.go:9]") {
		t.Errorf("%s: %s", outcome, detail)
	}
}

func TestHierarchyVerdictChecksCalleesSitesAndExclusions(t *testing.T) {
	outgoing := calls(json.RawMessage(`[{"to": {"name": "Register", "uri": "file:///lane/go/reg.go", "selectionRange": {"start": {"line": 13}}}, "fromRanges": []}]`), "to", "/lane/go", paths{})
	incoming := calls(json.RawMessage(`[{"from": {"name": "init", "uri": "file:///lane/go/a.go", "selectionRange": {"start": {"line": 1}}}, "fromRanges": [{"start": {"line": 2}}]}]`), "from", "/lane/go", paths{})
	if outcome, detail := hierarchyVerdict(outgoing, incoming, []string{"reg.go:14"}, []string{"a.go:3"}, 1, []string{"b.go#NewCashFlowReport"}); outcome != "agrees" {
		t.Errorf("%s: %s", outcome, detail)
	}
	if outcome, _ := hierarchyVerdict(outgoing, incoming, nil, nil, 0, []string{"reg.go#Register"}); outcome != "disagrees" {
		t.Errorf("an excluded callee returned = %s", outcome)
	}
}

func TestRenderTalliesAndEscapes(t *testing.T) {
	report := render("gopls vX", []verdict{{"a", "hover", "agrees", "x|y"}, {"b", "hover", "no answer", "none"}})
	if !strings.Contains(report, "| a | hover | agrees | x\\|y |") || !strings.Contains(report, "2 tasks: 1 agree, 0 disagree, 1 no answer.") {
		t.Errorf("report:\n%s", report)
	}
}
