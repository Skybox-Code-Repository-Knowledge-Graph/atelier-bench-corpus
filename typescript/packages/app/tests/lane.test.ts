/**
 * A real use for the global ambient constant in src/types/lane.d.ts (issue #223, wave 3, checklist
 * D.2): vitest.config.ts defines __ATELIER_LANE__ and src/lane.ts reads it.
 */
import { describe, expect, it } from "vitest";

import { laneName } from "@atelier/app/lane";

describe("build-time global", () => {
    it("reads the lane name the build defines", () => {
        expect(laneName()).toBe("typescript");
    });
});
