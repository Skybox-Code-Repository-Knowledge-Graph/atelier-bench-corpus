package workshop

// spoolDir is the print spool on Linux. The file name is the build
// constraint: a file ending in _linux.go compiles only for GOOS=linux, and
// this one carries no //go:build line.
func spoolDir() string {
	return "/var/spool/atelier"
}
