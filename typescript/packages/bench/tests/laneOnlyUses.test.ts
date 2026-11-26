/**
 * Real uses for the lane-only breadth constructs that nothing else referenced (issue #223,
 * checklist D.3): the `satisfies` config, the class + interface merge, the `export * as`
 * namespace re-export, the global Array augmentation and the `unique symbol` key. Each is a
 * language-feature fixture with no domain role, so the use lives in a test rather than in
 * application code.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { Rules, RULES } from "@atelier/bench";

import { secondPart } from "../src/support/arrayAugmentation";
import { rulesConfig } from "../src/support/rulesConfig";
import { tag } from "../src/support/uniqueKey";
import { Worker } from "../src/support/worker";

/** A concrete worker: the class body declares run, the merged interface half declares concurrency. */
class BatchWorker extends Worker {
    override readonly concurrency = 2;
    runs = 0;

    run(): void {
        this.runs += 1;
    }
}

describe("lane-only constructs are used", () => {
    it("keeps the object literal's own type under satisfies, not the checked Record", () => {
        expect(rulesConfig.minEvaluations).toBe(1);
        expect(rulesConfig.label).toBe("rules");
        // A `: Record<string, number | string>` annotation would make label `string | number`.
        expectTypeOf(rulesConfig).toEqualTypeOf<{ minEvaluations: number; label: string }>();
    });

    it("reads the member the interface half of a class + interface merge adds", () => {
        const worker: Worker = new BatchWorker();
        worker.run();

        expect(worker.concurrency).toBe(2);
        expect((worker as BatchWorker).runs).toBe(1);
    });

    it("imports the export * as namespace from the package root", () => {
        expect(Rules.RULES).toBe(RULES);
        expect(Rules.RULES).toHaveLength(48);
    });

    it("calls the member a global augmentation adds to every Array", () => {
        expect(secondPart(["first", "second"])).toBe("second");
        expect(secondPart(["only"])).toBeUndefined();
    });

    it("keys a value by a unique symbol", () => {
        const tagged = tag("rush-surcharge");

        expect(tagged.key).toBe("rush-surcharge");
        expect(Object.getOwnPropertySymbols(tagged)).toHaveLength(1);
    });
});
