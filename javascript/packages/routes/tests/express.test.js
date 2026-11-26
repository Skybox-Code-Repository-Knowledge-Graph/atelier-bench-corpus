import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";

import { createReportsApp } from "@atelier/routes/express/reportsRouter.js";

describe("express mounted router", () => {
    it("serves GET /api/reports/:slug through the mount prefix", async () => {
        const response = await request(createReportsApp()).get("/api/reports/gross-profit");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await request(createReportsApp()).get("/api/reports/nope")).status, 404);
    });
});
