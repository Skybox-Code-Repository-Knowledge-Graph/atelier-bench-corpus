/**
 * Real uses for the TypeScript-only breadth fixtures added for checklist D.2 (issue #223, wave 3):
 * a class implementing a type alias, a `this` parameter, an indexed access type and a Partial
 * mapped type over RepairOrder, a namespace import alias, an `infer` type variable and an interface
 * declaration merge. Each is a language-feature fixture with no domain role, so its use lives here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { Priority, RepairOrder, RepairStatus } from "@atelier/core";

import { type ElementOf } from "../src/support/elementOf";
import { bookedMinutes, loadDraftOrder } from "../src/support/loadedOrder";
import { changesPriority, deviceOf, type OrderPatch, type OrderStatusField, statusOf } from "../src/support/orderFields";
import { labelText, type PartLabel } from "../src/support/partLabel";
import { applyRules, FlatSurcharge, NoAdjustment, PercentDiscount, type PriceRule } from "../src/support/priceRule";
import { describeShelf, type Shelf } from "../src/support/thisParameter";
import { benchHours, Workshop } from "../src/support/workshopHours";

describe("TypeScript-only constructs are used", () => {
    it("implements a type alias with three classes", () => {
        const rules: PriceRule[] = [new PercentDiscount(10), new FlatSurcharge(500), new NoAdjustment()];

        // 58325c is the seed's revenue: 10% off rounds 52492.5 up to 52493, plus 500.
        expect(applyRules(rules, 58325)).toBe(52993);
        expect(rules.map((rule) => rule.name)).toEqual(["percent-discount", "flat-surcharge", "no-adjustment"]);
    });

    it("types this through a this parameter", () => {
        const shelf: Shelf = { bin: "B-04", capacity: 12 };

        expect(describeShelf.call(shelf)).toBe("B-04 holds 12 part(s)");
    });

    it("looks up order members through an indexed access type and a mapped type", () => {
        const order = RepairOrder.seed(9, 1, 1);
        const patch: OrderPatch = { priority: Priority.Rush };

        expect(statusOf(order)).toBe(RepairStatus.Received);
        expectTypeOf<OrderStatusField>().toEqualTypeOf<RepairStatus>();
        expect(changesPriority(patch)).toBe(true);
        expect(changesPriority({})).toBe(false);
        expect(deviceOf(RepairOrder.seed(9, 1, 3))).toBe(3);
    });

    it("reads a member of a type that ReturnType and Awaited compute", async () => {
        const loaded = await loadDraftOrder(10);
        loaded.laborMinutes = 45;

        expect(bookedMinutes(loaded)).toBe(45);
    });


    it("reads a nested namespace member through an import alias", () => {
        expect(benchHours(5)).toBe(40);
        expect(Workshop.Hours.RUSH_DAY).toBe(10);
    });

    it("binds an infer type variable", () => {
        expectTypeOf<ElementOf<readonly number[]>>().toEqualTypeOf<number>();
        expectTypeOf<ElementOf<string>>().toEqualTypeOf<never>();
    });

    it("merges two interface declarations into one label type", () => {
        const label: PartLabel = { sku: "SCR-OLED-6", bin: "B-04", shelf: "front" };

        expect(labelText(label)).toBe("SCR-OLED-6 @ B-04");
    });
});
