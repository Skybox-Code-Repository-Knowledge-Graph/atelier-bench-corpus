// Command atelier is the console entry point of the lane.
//
// The blank import below is the whole registration mechanism for the audit
// sink: nothing in this file calls into that package, and removing the import
// silently removes the sink.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"atelier.example/lane/app"
	"atelier.example/lane/app/commands"
	_ "atelier.example/lane/internal/audit"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is main without the process: it takes the arguments after the program
// name, writes to the two streams and returns the exit code, so every branch
// is testable.
func run(args []string, stdout io.Writer, stderr io.Writer) int {
	if len(args) < 1 {
		fmt.Fprintln(stdout, usage)
		return 2
	}
	state := app.SeededState()
	lines, err := dispatch(state, args[0], args[1:])
	if err != nil {
		fmt.Fprintln(stderr, "atelier:", err)
		return 1
	}
	fmt.Fprintln(stdout, strings.Join(lines, "\n"))
	return 0
}

// usage names the shared verbs first (export-report, recalculate-inventory),
// then this lane's own spellings of the same two operations, then export.
const usage = "usage: atelier <seed|export-report|recalculate-inventory|report|export|recalculate>"

// dispatch selects a command by STRING, the way a console kernel does. A
// shared verb shares its case clause with the lane's older spelling of the
// same operation, so each operation keeps one call site whichever verb asks.
func dispatch(state *app.State, command string, args []string) ([]string, error) {
	switch command {
	case "seed":
		lines := append([]string{app.Summarize(state)}, app.MetricLines(state)...)
		lines = append(lines, app.RuleLine(state))
		return append(lines, app.ServiceLines(state)...), nil
	case "export-report", "report":
		if len(args) < 1 {
			return nil, fmt.Errorf("%s needs a slug", command)
		}
		// export-report <slug> [format] defaults to json, as the shared
		// command does; report <slug> always renders markdown.
		format := "md"
		if command == "export-report" {
			format = "json"
			if len(args) > 1 {
				format = args[1]
			}
		}
		rendered, err := commands.ExportReport(state, args[0], format)
		if err != nil {
			return nil, err
		}
		return strings.Split(rendered, "\n"), nil
	case "export":
		return strings.Split(commands.ExportManifest(state), "\n"), nil
	case "recalculate-inventory", "recalculate":
		return []string{commands.RecalculateInventory(state)}, nil
	default:
		return nil, fmt.Errorf("unknown command %q", command)
	}
}
