package workshop

// Causes lists an error and every error it wraps, outermost first. The type
// switch asks for ANONYMOUS interface types, the two shapes that fmt.Errorf's
// %w and errors.Join leave behind: one wrapped error, or several.
func Causes(err error) []string {
	causes := []string{}
	for err != nil {
		causes = append(causes, err.Error())
		switch wrapped := err.(type) {
		case interface{ Unwrap() []error }:
			for _, inner := range wrapped.Unwrap() {
				causes = append(causes, Causes(inner)...)
			}
			return causes
		case interface{ Unwrap() error }:
			err = wrapped.Unwrap()
		default:
			return causes
		}
	}
	return causes
}
