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
		fmt.Fprintln(stdout, "usage: atelier <seed|report|export|recalculate>")
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

// dispatch selects a command by STRING, the way a console kernel does.
func dispatch(state *app.State, command string, args []string) ([]string, error) {
	switch command {
	case "seed":
		lines := append([]string{app.Summarize(state)}, app.MetricLines(state)...)
		lines = append(lines, app.RuleLine(state))
		return append(lines, app.ServiceLines(state)...), nil
	case "report":
		if len(args) < 1 {
			return nil, fmt.Errorf("report needs a slug")
		}
		rendered, err := commands.ExportReport(state, args[0], "md")
		if err != nil {
			return nil, err
		}
		return strings.Split(rendered, "\n"), nil
	case "export":
		return strings.Split(commands.ExportManifest(state), "\n"), nil
	case "recalculate":
		return []string{commands.RecalculateInventory(state)}, nil
	default:
		return nil, fmt.Errorf("unknown command %q", command)
	}
}
