package workshop

// Stage is a SEALED sum type. Its sealed method is unexported, so only a type
// declared in this package can have the method Stage asks for: a type in
// another package that declares its own sealed() has a different method,
// however it is spelled. The quote lines of core/quoting do exactly that and
// satisfy their own package's Line, never Stage.
type Stage interface {
	Caption() string
	sealed()
}

var (
	_ Stage = Received{}
	_ Stage = OnBench{}
	_ Stage = Returned{}
)

// Received is the first stage: the device is at the counter.
type Received struct{}

// Caption describes the stage.
func (Received) Caption() string { return "received at the counter" }

func (Received) sealed() {}

// OnBench is the repair stage.
type OnBench struct {
	Technician string
}

// Caption describes the stage.
func (b OnBench) Caption() string { return "on the bench with " + b.Technician }

func (OnBench) sealed() {}

// Returned is the last stage: the device is back with its owner.
type Returned struct{}

// Caption describes the stage.
func (Returned) Caption() string { return "returned to the customer" }

func (Returned) sealed() {}

// Stages is the order a ticket passes through.
func Stages(technician string) []Stage {
	return []Stage{Received{}, OnBench{Technician: technician}, Returned{}}
}
