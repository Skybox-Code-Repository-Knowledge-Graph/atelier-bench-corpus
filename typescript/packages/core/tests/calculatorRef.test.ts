/**
 * A real use for the import type in support/calculatorRef.ts (issue #223, wave 3, checklist D.2):
 * the alias names the calculator contract through `import(...)` in a type position.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { type InvoiceCalculator, RushInvoiceCalculator, StandardInvoiceCalculator } from "@atelier/core";

import { type CalculatorRef, chooseCalculator } from "../src/support/calculatorRef";

describe("import type", () => {
    it("names the same contract the module exports", () => {
        expectTypeOf<CalculatorRef>().toEqualTypeOf<InvoiceCalculator>();
    });

    it("picks the rush calculator only when asked", () => {
        const standard = new StandardInvoiceCalculator();
        const rush = new RushInvoiceCalculator();

        expect(chooseCalculator(false, standard, rush).name).toBe("standard");
        expect(chooseCalculator(true, standard, rush).name).toBe("rush");
    });
});
