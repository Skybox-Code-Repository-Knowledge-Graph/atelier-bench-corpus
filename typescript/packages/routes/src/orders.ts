/** What every framework route in this package serves: one seeded order, looked up by its reference. */

import { seededState } from "@atelier/app";

/** The body of `GET .../orders/:reference` in every framework fixture. */
export interface RoutedOrder {
    readonly reference: string;
    readonly status: string;
    readonly laborMinutes: number;
}

/** The seeded order with this reference, or undefined. */
export function routedOrder(reference: string): RoutedOrder | undefined {
    const order = seededState().data.orders.find((candidate) => candidate.reference() === reference);

    return order === undefined ? undefined : { reference, status: order.status, laborMinutes: order.laborMinutes };
}
