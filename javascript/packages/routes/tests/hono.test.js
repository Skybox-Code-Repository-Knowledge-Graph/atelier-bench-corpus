import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { app } from "@atelier/routes/hono/app.js";

describe("hono", () => {
    it("serves GET /api/reports/:slug through app.request", async () => {
        const response = await app.request("/api/reports/gross-profit");
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await app.request("/api/reports/nope")).status, 404);
    });
});
