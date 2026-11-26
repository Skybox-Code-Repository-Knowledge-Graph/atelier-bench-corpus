//! The calls of `support::method_pick`, run. `Brief`, `Measure` and `Stamp`
//! are imported; `Verbose` stays out of scope.

use atelier_bench::support::method_pick::{Brief, Measure, Stamp, Tagged, Ticket, Workload};

#[test]
fn the_trait_in_scope_picks_the_caption() {
    let ticket = Ticket::new("AT-2026-000001", 45);

    assert_eq!(ticket.caption(), "AT-2026-000001");
    assert_eq!(ticket.long_caption(), "AT-2026-000001 (45 min)");
}

#[test]
fn the_asked_type_picks_the_measure() {
    let ticket = Ticket::new("AT-2026-000002", 30);
    let minutes: u32 = ticket.measure();
    let label: String = ticket.measure();

    assert_eq!(minutes, 30);
    assert_eq!(label, "30 min");
}

#[test]
fn the_type_argument_picks_the_impl_block() {
    assert_eq!(Tagged(45_u32).describe(), "45 min");
    assert_eq!(Tagged("AT-2026-000001").describe(), "AT-2026-000001");
}

#[test]
fn an_owned_receiver_reaches_the_by_value_trait_method_first() {
    let closed = Ticket::new("AT-2026-000003", 15);
    let kept = Ticket::new("AT-2026-000004", 20);

    assert_eq!(Ticket::stamp(&kept), "AT-2026-000004 (kept)");
    assert_eq!(closed.stamp(), "AT-2026-000003 (closed)");
}

#[test]
fn collect_and_sum_build_the_same_workload() {
    let tickets = [
        Ticket::new("AT-2026-000001", 45),
        Ticket::new("AT-2026-000002", 30),
    ];
    let summed: Workload = tickets.iter().sum();
    let by_value: Workload = [Ticket::new("AT-2026-000003", 15)].into_iter().sum();
    let collected: Workload = tickets.into_iter().collect();

    assert_eq!((summed.minutes, summed.count), (75, 2));
    assert_eq!((by_value.minutes, by_value.count), (15, 1));
    assert_eq!(collected, summed);
}
