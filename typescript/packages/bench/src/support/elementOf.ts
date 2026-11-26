/**
 * `infer` declares a type variable inside the extends clause of a conditional type, and the true
 * branch reads it. `ElementOf<typeof DRAFT_QUEUE>` is RepairOrder only because the conditional
 * infers the queue's element type, so `queued.customerId` resolves into the order's base class.
 */
import type { RepairOrder } from "@atelier/core";

/** The element type of a readonly array type, or never. */
export type ElementOf<T> = T extends readonly (infer Item)[]
    ? Item
    : never;

/** Orders waiting for a bench, oldest first. */
export const DRAFT_QUEUE: readonly RepairOrder[] = [];

/** One queued order: the queue's element type, read back through `infer`. */
export type QueuedOrder = ElementOf<typeof DRAFT_QUEUE>;

/** The customer a queued order belongs to. */
export function queuedCustomer(queued: QueuedOrder): number {
    return queued.customerId;
}
