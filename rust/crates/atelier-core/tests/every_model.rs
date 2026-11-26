//! Reaches the core models and helpers no other test touches: labels, notes,
//! signatures, the repair-order policy and the left marker.

use atelier_core::models::label::{Label, Labelable};
use atelier_core::models::note::{NotableKind, Note};
use atelier_core::models::repair_order::RepairOrder;
use atelier_core::models::signature::Signature;
use atelier_core::policy::{Actor, RepairOrderPolicy};
use atelier_core::support::orientation::left_marker;
use atelier_core::support::pair::Left;

#[test]
fn a_label_lists_only_its_own_records_of_one_kind() {
    let label = Label::new(7, "urgent");
    let joins = [
        Labelable {
            label_id: 7,
            kind: NotableKind::RepairOrder,
            record_id: 1,
        },
        Labelable {
            label_id: 7,
            kind: NotableKind::Customer,
            record_id: 2,
        },
        Labelable {
            label_id: 8,
            kind: NotableKind::RepairOrder,
            record_id: 3,
        },
    ];

    let attached = label.attached_ids(&joins, NotableKind::RepairOrder);

    assert_eq!(attached, vec![1]);
}

#[test]
fn a_note_excerpt_keeps_short_bodies_and_shortens_long_ones() {
    let note = Note::new(1, NotableKind::Device, 4, "cracked hinge");

    assert_eq!(note.excerpt(80), "cracked hinge");
    assert_eq!(note.excerpt(8), "cracked\u{2026}");
}

#[test]
fn a_signature_is_captured_once_it_has_a_path() {
    let mut signature = Signature::new(1, 1, "Ada Byron");
    assert!(!signature.is_captured());

    signature.svg_path = "M0 0 L10 10".to_string();
    assert!(signature.is_captured());
}

#[test]
fn the_policy_lets_customers_see_only_their_own_orders() {
    let order = RepairOrder::new(1, 3, 9);
    let policy = RepairOrderPolicy;

    assert!(policy.can_view(Actor::Customer { id: 3 }, &order));
    assert!(!policy.can_view(Actor::Customer { id: 4 }, &order));
    assert!(policy.can_transition(Actor::Technician { id: 1 }, &order));
    assert!(!policy.can_transition(Actor::Customer { id: 3 }, &order));
    assert!(!policy.can_collect(Actor::Manager, &order));
}

#[test]
fn the_orientation_helper_hands_back_the_left_marker() {
    let _marker: Left = left_marker();
}
