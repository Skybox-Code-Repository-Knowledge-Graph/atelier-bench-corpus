package workshop

// spoolDir is the print spool on macOS. The file name is the build
// constraint: a file ending in _darwin.go compiles only for GOOS=darwin, and
// this one carries no //go:build line.
func spoolDir() string {
	return "/private/var/spool/atelier"
}
