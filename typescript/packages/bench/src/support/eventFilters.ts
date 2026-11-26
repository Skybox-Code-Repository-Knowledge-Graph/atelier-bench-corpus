/**
 * Extract filters a union at the type level: it is a distributive conditional type that keeps the
 * members assignable to `{ kind: "status_changed" }`, so `event.orderId` reads that member's
 * property, not the repair_completed member's.
 */
import type { DomainEvent } from "@atelier/core";

export type StatusChangedEvent = Extract<DomainEvent, { kind: "status_changed" }>;

/** The order a status change belongs to. */
export function changedOrder(event: StatusChangedEvent): number {
    return event.orderId;
}
