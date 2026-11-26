/**
 * An import type query: `typeof import("./orderFields")` is the type of that module's namespace
 * object, so `fields.statusOf` names orderFields' export although this file imports nothing from
 * it; the bare `statusOf` on the same line is this module's own look-alike.
 */
import type { RepairOrder } from "@atelier/core";

/** This module's own label for an order's status. */
function statusOf(order: RepairOrder): string {
    return `status ${order.status}`;
}

/** An order's status read through a module handed in as a value, for example a lazy `import()`. */
export function lazyStatus(fields: typeof import("./orderFields"), order: RepairOrder): string {
    return `${fields.statusOf(order)} (${statusOf(order)})`;
}
