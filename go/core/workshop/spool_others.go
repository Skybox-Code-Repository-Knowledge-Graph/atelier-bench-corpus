//go:build !linux && !darwin

package workshop

// spoolDir is the print spool on every other platform. "others" is no GOOS,
// so this file name constrains nothing and the //go:build line above does.
func spoolDir() string {
	return "spool"
}
