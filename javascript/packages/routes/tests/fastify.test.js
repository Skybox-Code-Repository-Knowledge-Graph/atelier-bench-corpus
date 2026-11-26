import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildServer } from "@atelier/routes/fastify/server.js";

describe("fastify", () => {
    it("serves GET /api/reports/:slug through inject, with no listener", async () => {
        const server = buildServer();
        const response = await server.inject({ method: "GET", url: "/api/reports/gross-profit" });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await server.inject({ method: "GET", url: "/api/reports/nope" })).statusCode, 404);
        await server.close();
    });
});
