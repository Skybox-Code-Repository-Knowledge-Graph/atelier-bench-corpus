import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "@atelier/routes/expo/app/api/reports/[slug]+api.js";

describe("expo router api route", () => {
    it("runs the +api.js GET handler for /api/reports/[slug]", async () => {
        const response = GET(new Request("http://localhost/api/reports/gross-profit"), { slug: "gross-profit" });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal(GET(new Request("http://localhost/api/reports/nope"), { slug: "nope" }).status, 404);
    });
});
