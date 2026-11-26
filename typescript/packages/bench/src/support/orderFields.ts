/**
 * Two type-level member lookups on RepairOrder. An indexed access type names a property by a string
 * literal; the Partial mapped type re-declares every property as optional. Both resolve to the
 * property the order declares (on its base class in models/repairOrder.ts), not to a new member.
 */

import type { RepairOrder } from "@atelier/core";

/** The type of the order's status property, looked up by name. */
export type OrderStatusField = RepairOrder["status"];

/** A partial update of an order: every property optional. */
export type OrderPatch = Partial<RepairOrder>;

/** Read the status through the indexed access type. */
export function statusOf(order: RepairOrder): OrderStatusField {
    return order.status;
}

/** True when the patch sets a priority. */
export function changesPriority(patch: OrderPatch): boolean {
    return patch.priority !== undefined;
}
