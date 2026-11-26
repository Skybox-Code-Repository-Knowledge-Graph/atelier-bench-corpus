/** Type guard and assertion function narrowing a RepairOrder by priority. */

import type { RepairOrder } from "../models/repairOrder";
import { Priority } from "./priority";

/**
 * A RepairOrder narrowed to rush priority. It is an interface that extends the RepairOrder class:
 * TypeScript lets an interface name a class as its parent and inherit the class's members.
 */
export interface RushOrder extends RepairOrder {
    priority: Priority.Rush;
}

/** Type guard: true only for rush-priority orders. */
export function isRush(order: RepairOrder): order is RushOrder {
    return order.priority === Priority.Rush;
}

/** Assertion function: throws unless the order is rush-priority. */
export function assertRush(order: RepairOrder): asserts order is RushOrder {
    if (!isRush(order)) {
        throw new TypeError("expected a rush-priority order");
    }
}

/** The priority of an order the caller requires to be rush; after assertRush it can only be Rush. */
export function rushTier(order: RepairOrder): Priority.Rush {
    assertRush(order);
    return order.priority;
}
