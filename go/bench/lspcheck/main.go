// Command lspcheck runs the language server the go lane's stack starts,
// gopls, over every hover, document_symbol, call_hierarchy and
// implementation task of bench/tasks.json, and writes one verdict line per
// task: agrees, disagrees or no answer, with what the server returned.
//
// The server is evidence to hold a key against, never a source for one: where
// the two disagree the tree decides, and the reading is written down in the
// lane README; no key is changed because the server said so.
//
//	cd go && go run ./bench/lspcheck -gopls "$(go env GOPATH)/bin/gopls" -out bench/lsp-check.md
//
// It speaks LSP over stdio with the standard library only, and runs the
// server with GOOS=linux, the platform of the lane's CI job.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// surfaces are the language-server surfaces this check covers, in report order.
var surfaces = []string{"hover", "document_symbol", "call_hierarchy", "implementation"}

type site struct {
	File   string `json:"file"`
	Needle string `json:"needle"`
}

type task struct {
	ID      string `json:"id"`
	Surface string `json:"surface"`
	From    struct {
		File       string  `json:"file"`
		Needle     string  `json:"needle"`
		Symbol     *string `json:"symbol"`
		Occurrence int     `json:"occurrence"`
	} `json:"from"`
	Expect struct {
		Contains         string          `json:"contains"`
		MinSymbols       int             `json:"min_symbols"`
		MustInclude      json.RawMessage `json:"must_include"`
		Implementations  []site          `json:"implementations"`
		OptionalSites    []site          `json:"optional_sites"`
		OutgoingIncludes []site          `json:"outgoing_includes"`
		IncomingIncludes []site          `json:"incoming_includes"`
		MinIncoming      int             `json:"min_incoming"`
		MustNotInclude   []string        `json:"must_not_include"`
	} `json:"expect"`
}

// verdict is one report line.
type verdict struct {
	ID, Surface, Outcome, Detail string
}

func main() {
	gopls := flag.String("gopls", "gopls", "path of the gopls binary")
	out := flag.String("out", "", "write the report here instead of stdout")
	flag.Parse()
	root, err := os.Getwd()
	if err != nil {
		fail(err)
	}
	report, err := run(root, *gopls)
	if err != nil {
		fail(err)
	}
	if *out == "" {
		fmt.Print(report)
		return
	}
	if err := os.WriteFile(*out, []byte(report), 0o644); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "lspcheck:", err)
	os.Exit(1)
}

// run starts the server, asks every task and renders the report.
func run(root string, gopls string) (string, error) {
	tasks, err := loadTasks(filepath.Join(root, "bench", "tasks.json"))
	if err != nil {
		return "", err
	}
	version, err := exec.Command(gopls, "version").Output()
	if err != nil {
		return "", fmt.Errorf("gopls version: %v", err)
	}
	env := envOf()
	command := exec.Command(gopls)
	command.Dir = root
	command.Env = append(os.Environ(), "GOOS=linux", "GOFLAGS=")
	stdin, _ := command.StdinPipe()
	stdout, _ := command.StdoutPipe()
	if err := command.Start(); err != nil {
		return "", err
	}
	server := &client{in: stdin, out: bufio.NewReader(stdout)}
	defer func() {
		_, _ = server.call("shutdown", nil)
		_ = server.notify("exit", nil)
		_ = command.Wait()
	}()
	rootURI := fileURI(root)
	if _, err := server.call("initialize", map[string]any{
		"processId": os.Getpid(), "rootUri": rootURI,
		"workspaceFolders": []map[string]string{{"uri": rootURI, "name": "go"}},
		"capabilities": map[string]any{"textDocument": map[string]any{
			"hover":          map[string]any{"contentFormat": []string{"plaintext"}},
			"documentSymbol": map[string]any{"hierarchicalDocumentSymbolSupport": true},
			"callHierarchy":  map[string]any{}, "implementation": map[string]any{},
		}},
	}); err != nil {
		return "", err
	}
	if err := server.notify("initialized", map[string]any{}); err != nil {
		return "", err
	}
	locate := func(s site) string { return lineKey(root, s) }
	var verdicts []verdict
	for _, t := range tasks {
		v, err := ask(server, root, t, locate, env)
		if err != nil {
			v = verdict{t.ID, t.Surface, "no answer", "request failed: " + err.Error()}
		}
		verdicts = append(verdicts, v)
	}
	return render(strings.TrimSpace(strings.SplitN(string(version), "\n", 2)[0]), verdicts), nil
}

// ask sends the request a task's surface needs and judges the reply.
func ask(server *client, root string, t task, locate func(site) string, env paths) (verdict, error) {
	text, err := os.ReadFile(filepath.Join(root, t.From.File))
	if err != nil {
		return verdict{}, err
	}
	uri := fileURI(filepath.Join(root, t.From.File))
	if err := server.notify("textDocument/didOpen", map[string]any{"textDocument": map[string]any{
		"uri": uri, "languageId": "go", "version": 1, "text": string(text)}}); err != nil {
		return verdict{}, err
	}
	doc := map[string]any{"uri": uri}
	if t.Surface == "document_symbol" {
		raw, err := server.call("textDocument/documentSymbol", map[string]any{"textDocument": doc})
		if err != nil {
			return verdict{}, err
		}
		outcome, detail := docsymVerdict(raw, t.Expect.MinSymbols, names(t.Expect.MustInclude))
		return verdict{t.ID, t.Surface, outcome, detail}, nil
	}
	line, column, err := position(string(text), t.From.Needle, t.From.Symbol, t.From.Occurrence)
	if err != nil {
		return verdict{}, err
	}
	at := map[string]any{"textDocument": doc, "position": map[string]int{"line": line, "character": column}}
	switch t.Surface {
	case "hover":
		raw, err := server.call("textDocument/hover", at)
		if err != nil {
			return verdict{}, err
		}
		outcome, detail := hoverVerdict(raw, t.Expect.Contains)
		return verdict{t.ID, t.Surface, outcome, detail}, nil
	case "implementation":
		raw, err := server.call("textDocument/implementation", at)
		if err != nil {
			return verdict{}, err
		}
		outcome, detail := implementationVerdict(locations(raw, root, env), keys(t.Expect.Implementations, locate), keys(t.Expect.OptionalSites, locate))
		return verdict{t.ID, t.Surface, outcome, detail}, nil
	default: // call_hierarchy
		raw, err := server.call("textDocument/prepareCallHierarchy", at)
		if err != nil {
			return verdict{}, err
		}
		var items []json.RawMessage
		if json.Unmarshal(raw, &items) != nil || len(items) == 0 {
			return verdict{t.ID, t.Surface, "no answer", "prepareCallHierarchy returned no item"}, nil
		}
		outgoing, err := server.call("callHierarchy/outgoingCalls", map[string]any{"item": items[0]})
		if err != nil {
			return verdict{}, err
		}
		incoming, err := server.call("callHierarchy/incomingCalls", map[string]any{"item": items[0]})
		if err != nil {
			return verdict{}, err
		}
		outcome, detail := hierarchyVerdict(calls(outgoing, "to", root, env), calls(incoming, "from", root, env),
			keys(t.Expect.OutgoingIncludes, locate), keys(t.Expect.IncomingIncludes, locate), t.Expect.MinIncoming, t.Expect.MustNotInclude)
		return verdict{t.ID, t.Surface, outcome, detail}, nil
	}
}

func loadTasks(path string) ([]task, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest struct {
		Tasks []task `json:"tasks"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	selected := []task{}
	for _, surface := range surfaces {
		for _, t := range manifest.Tasks {
			if t.Surface == surface {
				selected = append(selected, t)
			}
		}
	}
	return selected, nil
}

// position finds the 0-based line of the needle and the UTF-16 column of the
// symbol's occurrence on it (the first, unless occurrence says otherwise).
func position(text string, needle string, symbol *string, occurrence int) (int, int, error) {
	for index, line := range strings.Split(text, "\n") {
		if !strings.Contains(line, needle) {
			continue
		}
		if symbol == nil {
			return index, 0, nil
		}
		if occurrence < 1 {
			occurrence = 1
		}
		seen := 0
		for offset := 0; offset+len(*symbol) <= len(line); offset++ {
			if strings.HasPrefix(line[offset:], *symbol) && boundary(line, offset, offset+len(*symbol)) {
				seen++
				if seen == occurrence {
					return index, utf16Len(line[:offset]), nil
				}
			}
		}
		return 0, 0, fmt.Errorf("symbol %q not on line %d", *symbol, index+1)
	}
	return 0, 0, fmt.Errorf("needle not found: %q", needle)
}

func boundary(line string, start int, end int) bool {
	word := func(b byte) bool {
		return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
	}
	return (start == 0 || !word(line[start-1])) && (end == len(line) || !word(line[end]))
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// lineKey is "file:line" (1-based) of a key site, or "file:?" when its needle
// is not in the file.
func lineKey(root string, s site) string {
	raw, err := os.ReadFile(filepath.Join(root, s.File))
	if err == nil {
		for index, line := range strings.Split(string(raw), "\n") {
			if strings.Contains(line, s.Needle) {
				return fmt.Sprintf("%s:%d", s.File, index+1)
			}
		}
	}
	return s.File + ":?"
}

func keys(sites []site, locate func(site) string) []string {
	out := []string{}
	for _, s := range sites {
		out = append(out, locate(s))
	}
	return out
}

// paths are the roots a location outside the lane is written against, so the
// committed report names no machine-specific directory.
type paths struct{ goroot, modcache string }

func envOf() paths {
	value := func(name string) string {
		out, _ := exec.Command("go", "env", name).Output()
		return strings.TrimSpace(string(out))
	}
	return paths{goroot: value("GOROOT"), modcache: value("GOMODCACHE")}
}

func fileURI(path string) string {
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
}

// relPath turns a server URI into a lane-relative path, $GOROOT/... or
// $GOMODCACHE/....
func relPath(uri string, root string, env paths) string {
	parsed, err := url.Parse(uri)
	path := uri
	if err == nil && parsed.Scheme == "file" {
		path = parsed.Path
	}
	for _, base := range []struct{ dir, label string }{{root, ""}, {env.goroot, "$GOROOT/"}, {env.modcache, "$GOMODCACHE/"}} {
		if base.dir != "" && strings.HasPrefix(path, base.dir+"/") {
			return base.label + strings.TrimPrefix(path, base.dir+"/")
		}
	}
	return "(outside the lane)/" + filepath.Base(path)
}

type location struct {
	URI   string `json:"uri"`
	Range struct {
		Start struct {
			Line int `json:"line"`
		} `json:"start"`
	} `json:"range"`
}

// locations reads a Location[] reply as sorted "file:line" keys.
func locations(raw json.RawMessage, root string, env paths) []string {
	var list []location
	_ = json.Unmarshal(raw, &list)
	out := []string{}
	for _, l := range list {
		out = append(out, fmt.Sprintf("%s:%d", relPath(l.URI, root, env), l.Range.Start.Line+1))
	}
	sort.Strings(out)
	return out
}

// call is one edge of a call-hierarchy reply: the other end's name and
// declaration line, and the call-site lines.
type call struct {
	Name, Decl string
	Sites      []string
}

func calls(raw json.RawMessage, end string, root string, env paths) []call {
	var list []map[string]json.RawMessage
	_ = json.Unmarshal(raw, &list)
	out := []call{}
	for _, entry := range list {
		var item struct {
			Name           string `json:"name"`
			URI            string `json:"uri"`
			SelectionRange struct {
				Start struct {
					Line int `json:"line"`
				} `json:"start"`
			} `json:"selectionRange"`
		}
		_ = json.Unmarshal(entry[end], &item)
		var ranges []struct {
			Start struct {
				Line int `json:"line"`
			} `json:"start"`
		}
		_ = json.Unmarshal(entry["fromRanges"], &ranges)
		file := relPath(item.URI, root, env)
		c := call{Name: item.Name, Decl: fmt.Sprintf("%s:%d", file, item.SelectionRange.Start.Line+1)}
		for _, r := range ranges {
			c.Sites = append(c.Sites, fmt.Sprintf("%s:%d", file, r.Start.Line+1))
		}
		out = append(out, c)
	}
	return out
}

func hoverVerdict(raw json.RawMessage, contains string) (string, string) {
	var reply struct {
		Contents json.RawMessage `json:"contents"`
	}
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &reply) != nil || len(reply.Contents) == 0 {
		return "no answer", "no hover at the position"
	}
	text := ""
	var markup struct {
		Value string `json:"value"`
	}
	var plain string
	var list []json.RawMessage
	switch {
	case json.Unmarshal(reply.Contents, &plain) == nil:
		text = plain
	case json.Unmarshal(reply.Contents, &markup) == nil && markup.Value != "":
		text = markup.Value
	case json.Unmarshal(reply.Contents, &list) == nil:
		for _, part := range list {
			var piece string
			if json.Unmarshal(part, &piece) != nil {
				_ = json.Unmarshal(part, &markup)
				piece = markup.Value
			}
			text += piece + "\n"
		}
	}
	first := strings.Join(strings.Fields(text), " ")
	if len(first) > 140 {
		first = first[:140] + "..."
	}
	if strings.Contains(text, contains) {
		return "agrees", fmt.Sprintf("contains %q: %s", contains, first)
	}
	return "disagrees", fmt.Sprintf("lacks %q: %s", contains, first)
}

func docsymVerdict(raw json.RawMessage, minSymbols int, mustInclude []string) (string, string) {
	var tree []struct {
		Name     string          `json:"name"`
		Children json.RawMessage `json:"children"`
	}
	if json.Unmarshal(raw, &tree) != nil || len(tree) == 0 {
		return "no answer", "no document symbols"
	}
	names := []string{}
	var walk func(json.RawMessage)
	walk = func(level json.RawMessage) {
		var nodes []struct {
			Name     string          `json:"name"`
			Children json.RawMessage `json:"children"`
		}
		_ = json.Unmarshal(level, &nodes)
		for _, node := range nodes {
			// gopls names a method "(*RepairOrder).TransitionTo"; the key
			// names the identifier, so the method name after the receiver
			// is what is matched.
			names = append(names, methodName(node.Name))
			if len(node.Children) > 0 {
				walk(node.Children)
			}
		}
	}
	walk(raw)
	have := map[string]bool{}
	for _, name := range names {
		have[name] = true
	}
	missing := []string{}
	for _, name := range mustInclude {
		if !have[name] {
			missing = append(missing, name)
		}
	}
	detail := fmt.Sprintf("%d symbols (min_symbols %d)", len(names), minSymbols)
	if len(missing) > 0 || len(names) < minSymbols {
		return "disagrees", detail + "; missing " + strings.Join(missing, ", ")
	}
	return "agrees", detail + "; every must_include name present"
}

func implementationVerdict(returned []string, implementations []string, optional []string) (string, string) {
	if len(returned) == 0 {
		return "no answer", "0 locations"
	}
	got := set(returned)
	allowed := set(append(append([]string{}, implementations...), optional...))
	missing := []string{}
	for _, key := range implementations {
		if !got[key] {
			missing = append(missing, key)
		}
	}
	extra := []string{}
	for _, location := range returned {
		if !allowed[location] {
			extra = append(extra, location)
		}
	}
	detail := fmt.Sprintf("%d locations for %d keyed implementors", len(returned), len(implementations))
	if len(missing) == 0 && len(extra) == 0 {
		return "agrees", detail + " (+ optional sites only)"
	}
	return "disagrees", detail + "; missing [" + strings.Join(missing, " ") + "]; not in the key [" + strings.Join(extra, " ") + "]"
}

func hierarchyVerdict(outgoing []call, incoming []call, outgoingKeys []string, incomingKeys []string, minIncoming int, mustNot []string) (string, string) {
	if len(outgoing) == 0 && len(incoming) == 0 {
		return "no answer", "no outgoing and no incoming calls"
	}
	callees := map[string]bool{}
	for _, c := range outgoing {
		callees[c.Decl] = true
	}
	sites := map[string]bool{}
	for _, c := range incoming {
		for _, s := range c.Sites {
			sites[s] = true
		}
	}
	problems := []string{}
	for _, key := range outgoingKeys {
		if !callees[key] {
			problems = append(problems, "callee "+key+" not returned")
		}
	}
	for _, key := range incomingKeys {
		if !sites[key] {
			problems = append(problems, "call site "+key+" not returned")
		}
	}
	if len(incoming) < minIncoming {
		problems = append(problems, fmt.Sprintf("%d callers < min_incoming %d", len(incoming), minIncoming))
	}
	for _, excluded := range mustNot {
		file, name, _ := strings.Cut(excluded, "#")
		for _, c := range outgoing {
			if c.Name == name && strings.HasPrefix(c.Decl, file+":") {
				problems = append(problems, "excluded "+excluded+" returned")
			}
		}
	}
	detail := fmt.Sprintf("%d outgoing, %d incoming callers", len(outgoing), len(incoming))
	if len(problems) > 0 {
		return "disagrees", detail + "; " + strings.Join(problems, "; ")
	}
	return "agrees", detail + "; every keyed callee and call site returned, no excluded callee"
}

// methodName drops the receiver of a server-side method name:
// "(*RepairOrder).TransitionTo" and "Money.Times" become the method name.
func methodName(name string) string {
	if strings.HasPrefix(name, "(") || strings.Contains(name, ".") {
		return name[strings.LastIndex(name, ".")+1:]
	}
	return name
}

// names reads must_include as a list; on the surfaces checked here it is
// always one (parse-negative tasks give it as a single string).
func names(raw json.RawMessage) []string {
	var list []string
	_ = json.Unmarshal(raw, &list)
	return list
}

func set(items []string) map[string]bool {
	out := map[string]bool{}
	for _, item := range items {
		out[item] = true
	}
	return out
}

// render writes the report: header, one table row per task, a tally.
func render(version string, verdicts []verdict) string {
	var b strings.Builder
	b.WriteString("# Language-server check: go lane\n\n")
	b.WriteString("Generated by `bench/lspcheck`; do not edit by hand, re-run it.\n\n")
	fmt.Fprintf(&b, "- Server: %s (the server the lane's stack starts)\n", version)
	b.WriteString("- Command, from `go/`: `go run ./bench/lspcheck -gopls \"$(go env GOPATH)/bin/gopls\" -out bench/lsp-check.md`\n")
	b.WriteString("- Build context: GOOS=linux (the lane's CI platform)\n")
	fmt.Fprintf(&b, "- Run: %s\n", time.Now().UTC().Format("2006-01-02"))
	b.WriteString("- Scope: every hover, document_symbol, call_hierarchy and implementation task of `bench/tasks.json`. The server is compared with each key, never used to make one; the lane README reads every disagreement against the tree.\n\n")
	b.WriteString("| task | surface | verdict | what the server returned |\n| --- | --- | --- | --- |\n")
	tally := map[string]int{}
	for _, v := range verdicts {
		tally[v.Outcome]++
		fmt.Fprintf(&b, "| %s | %s | %s | %s |\n", v.ID, v.Surface, v.Outcome, strings.ReplaceAll(v.Detail, "|", "\\|"))
	}
	fmt.Fprintf(&b, "\n%d tasks: %d agree, %d disagree, %d no answer.\n", len(verdicts), tally["agrees"], tally["disagrees"], tally["no answer"])
	return b.String()
}

// client is a minimal synchronous LSP client over the server's stdio.
type client struct {
	in   io.Writer
	out  *bufio.Reader
	next int
}

func (c *client) notify(method string, params any) error {
	return writeMessage(c.in, map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

// call sends a request and reads until its response, answering the server's
// own requests (configuration, progress, registration) with empty results.
func (c *client) call(method string, params any) (json.RawMessage, error) {
	c.next++
	id := c.next
	if err := writeMessage(c.in, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	for {
		body, err := readMessage(c.out)
		if err != nil {
			return nil, err
		}
		var message struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params struct {
				Items []json.RawMessage `json:"items"`
			} `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(body, &message); err != nil {
			return nil, err
		}
		switch {
		case message.Method != "" && len(message.ID) > 0:
			var result any
			if message.Method == "workspace/configuration" {
				result = make([]any, len(message.Params.Items))
			}
			if err := writeMessage(c.in, map[string]any{"jsonrpc": "2.0", "id": message.ID, "result": result}); err != nil {
				return nil, err
			}
		case message.Method == "" && string(message.ID) == strconv.Itoa(id):
			if message.Error != nil {
				return nil, fmt.Errorf("%s: %s", method, message.Error.Message)
			}
			return message.Result, nil
		}
	}
}

func writeMessage(w io.Writer, message any) error {
	body, err := json.Marshal(message)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "Content-Length: %d\r\n\r\n%s", len(body), body)
	return err
}

func readMessage(r *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		header, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		header = strings.TrimRight(header, "\r\n")
		if header == "" {
			break
		}
		if name, value, found := strings.Cut(header, ":"); found && strings.EqualFold(name, "Content-Length") {
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, err
			}
		}
	}
	if length < 0 {
		return nil, fmt.Errorf("message without Content-Length")
	}
	body := make([]byte, length)
	_, err := io.ReadFull(r, body)
	return bytes.TrimSpace(body), err
}
