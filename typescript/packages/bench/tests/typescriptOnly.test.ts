/**
 * Real uses for the TypeScript-only breadth fixtures added for checklist D.2 (issue #223, wave 3):
 * a class implementing a type alias, a `this` parameter, an indexed access type and a Partial
 * mapped type over RepairOrder, a namespace import alias, an `infer` type variable and an interface
 * declaration merge; and, after bounce 1 (R18), ThisType, a template literal index signature, a
 * `this is` method predicate, Extract over a union, function + namespace and enum + enum merging, a
 * typed event map read through an indexed access by a generic key, and a module member read
 * through an import type query. Each is a language-feature fixture with no domain role, so its use
 * lives here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { Priority, RepairOrder, RepairStatus } from "@atelier/core";

import { type ElementOf, type QueuedOrder, queuedCustomer } from "../src/support/elementOf";
import { BenchEvents, watchStock } from "../src/support/benchEvents";
import { changedOrder, type StatusChangedEvent } from "../src/support/eventFilters";
import { IntakeStage, onBench } from "../src/support/intakeStage";
import { bookedMinutes, loadDraftOrder } from "../src/support/loadedOrder";
import { changesPriority, deviceOf, type OrderPatch, type OrderStatusField, statusOf } from "../src/support/orderFields";
import { labelText, type PartLabel } from "../src/support/partLabel";
import { applyRules, FlatSurcharge, NoAdjustment, PercentDiscount, type PriceRule } from "../src/support/priceRule";
import { partCode } from "../src/support/partCode";
import { lazyStatus } from "../src/support/lazyFields";
import { rushNote, RushTicket, Ticket } from "../src/support/rushTicket";
import { describeShelf, type Shelf } from "../src/support/thisParameter";
import { bayMethods } from "../src/support/thisTypeMarker";
import { type TraceHeaders, traceId } from "../src/support/traceHeaders";
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
        expectTypeOf<QueuedOrder>().toEqualTypeOf<RepairOrder>();
        expect(queuedCustomer(RepairOrder.seed(9, 4, 1))).toBe(4);
    });

    it("merges two interface declarations into one label type", () => {
        const label: PartLabel = { sku: "SCR-OLED-6", bin: "B-04", shelf: "front" };

        expect(labelText(label)).toBe("SCR-OLED-6 @ B-04");
    });

    it("types this inside an object literal through ThisType", () => {
        expect(bayMethods.free.call({ capacity: 12, used: 5 })).toBe(7);
    });

    it("reads a header key through a template literal pattern index signature", () => {
        const headers: TraceHeaders = { "x-trace-id": "AT-2026-000001", accept: "application/json" };

        expect(traceId(headers)).toBe("AT-2026-000001");
    });

    it("narrows a receiver through a this-predicate method", () => {
        expect(rushNote(new RushTicket("AT-2026-000002", "17:00"))).toBe("rush ticket AT-2026-000002 by 17:00");
        expect(rushNote(new Ticket("AT-2026-000001"))).toBeUndefined();
    });

    it("filters the domain event union with Extract", () => {
        const event: StatusChangedEvent = { kind: "status_changed", orderId: 2, from: RepairStatus.Diagnosing, to: RepairStatus.AwaitingParts };

        expect(changedOrder(event)).toBe(2);
    });

    it("merges a namespace into a function", () => {
        expect(partCode("SCR-OLED-6", "B-04")).toBe("SCR-OLED-6/B-04");
        expect(partCode("SCR-OLED-6", "B-04", { separator: ":" })).toBe("SCR-OLED-6:B-04");
    });

    it("merges two enum declarations into one", () => {
        expect(onBench(IntakeStage.Received)).toBe(true);
        expect(onBench(IntakeStage.Booked)).toBe(false);
    });

    it("types an event handler through an indexed access by its generic key", () => {
        const events = new BenchEvents();
        const low: string[] = [];
        watchStock(events, low);
        events.emit("stock_low", { sku: "SCR-OLED-6", onHand: 1 });
        events.emit("part_returned", { sku: "BAT-IP12", bin: "B-04" });

        expect(low).toEqual(["SCR-OLED-6"]);
    });

    it("reads a module member through an import type query", async () => {
        const fields = await import("../src/support/orderFields");

        expect(lazyStatus(fields, RepairOrder.seed(9, 1, 1))).toBe("received (status received)");
    });
});
