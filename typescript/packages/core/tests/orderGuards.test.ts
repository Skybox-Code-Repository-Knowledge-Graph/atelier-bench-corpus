/**
 * A real use for the type guard and the assertion function in support/orderGuards.ts (issue #223,
 * checklist D.3): both narrow a RepairOrder by priority, and nothing called either before.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { Priority, RepairOrder } from "@atelier/core";

import { assertRush, isRush, type RushOrder } from "../src/support/orderGuards";

describe("order guards", () => {
    it("narrows only a rush-priority order", () => {
        const order = RepairOrder.seed(7, 1, 1);

        expect(isRush(order)).toBe(false);
        order.priority = Priority.Rush;
        expect(isRush(order)).toBe(true);
        if (isRush(order)) {
            expectTypeOf(order).toEqualTypeOf<RushOrder>();
        }
    });

    it("asserts rush priority or throws", () => {
        const order = RepairOrder.seed(8, 1, 1);

        expect(() => assertRush(order)).toThrow(/rush-priority/);
        order.priority = Priority.Rush;
        assertRush(order);
        expectTypeOf(order.priority).toEqualTypeOf<Priority.Rush>();
    });
});
