/**
 * A real use for the import type in support/identifiedRef.ts (issue #223, wave 3, checklist D.2):
 * the alias names the Identified interface through `import(...)` in a type position.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { RepairOrder } from "@atelier/core";
import type { Identified } from "../src/contracts/repository";

import { type IdentifiedRef, idsOf } from "../src/support/identifiedRef";

describe("import type", () => {
    it("names the same interface the module exports", () => {
        expectTypeOf<IdentifiedRef>().toEqualTypeOf<Identified>();
    });

    it("reads the id of every record typed through it", () => {
        expect(idsOf([RepairOrder.seed(5, 1, 1), RepairOrder.seed(6, 2, 2)])).toEqual([5, 6]);
    });
});
