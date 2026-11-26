package contracts

import "atelier.example/lane/atelier/dataset"

// RuleContract is the NOMINAL rule contract: the 24 rule structs each carry a
// compile-time assertion against it.
type RuleContract interface {
	Key() string
	Evaluate(data *dataset.Dataset) bool
}

// RuleLike is the STRUCTURAL twin: the same method set under a different
// name. Every type with that method set satisfies it without naming it:
// adhoc.AdHocRule, whose 24 values assert nothing at all, and the 24 nominal
// rule structs, which assert RuleContract only.
type RuleLike interface {
	Key() string
	Evaluate(data *dataset.Dataset) bool
}

// SatisfiedBy counts the rules that hold on a dataset. Its constraint is the
// STRUCTURAL RuleLike, so any slice of rule-shaped values qualifies with no
// conversion: the registry's []RuleContract and adhoc's []AdHocRule alike.
func SatisfiedBy[R RuleLike](rules []R, data *dataset.Dataset) int {
	satisfied := 0
	for _, rule := range rules {
		if rule.Evaluate(data) {
			satisfied++
		}
	}
	return satisfied
}
