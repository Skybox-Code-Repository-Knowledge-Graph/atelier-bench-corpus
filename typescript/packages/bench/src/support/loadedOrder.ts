/**
 * A type computed by built-in utility types: ReturnType reads a function's inferred return type and
 * Awaited unwraps its promise, so `loaded.laborMinutes` resolves into RepairOrder although no
 * annotation in this file names that class.
 */

import { RepairOrder } from "@atelier/core";

/** Load one draft order; the return type is inferred, never written. */
export async function loadDraftOrder(id: number) {
    return RepairOrder.seed(id, 1, 1);
}

/** Whatever loadDraftOrder resolves to. */
export type LoadedOrder = Awaited<ReturnType<typeof loadDraftOrder>>;

/** Minutes already booked on a loaded order. */
export function bookedMinutes(loaded: LoadedOrder): number {
    return loaded.laborMinutes;
}
