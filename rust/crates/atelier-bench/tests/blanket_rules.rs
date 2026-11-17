//! Use site for the `Vec<T>` blanket impl of `RuleContract`.

use atelier_bench::contracts::rule_contract::RuleContract;
use atelier_bench::dataset::Dataset;
use atelier_bench::rules::gross_profit_rule::GrossProfitRule;

#[test]
fn vec_of_rules_evaluates_through_the_blanket_impl() {
    let data = Dataset::seeded();
    let rules = vec![GrossProfitRule, GrossProfitRule];

    assert!(rules.evaluate(&data));
}
