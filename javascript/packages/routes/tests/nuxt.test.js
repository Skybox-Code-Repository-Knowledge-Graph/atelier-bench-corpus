import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, createRouter, toWebHandler } from "h3";

import reportHandler from "@atelier/routes/nuxt/server/api/reports/[slug].get.js";

describe("nuxt (h3 server route)", () => {
    it("serves GET /api/reports/:slug, routed the way the file name says", async () => {
        const router = createRouter().get("/api/reports/:slug", reportHandler);
        const fetchHandler = toWebHandler(createApp().use(router));
        const response = await fetchHandler(new Request("http://localhost/api/reports/gross-profit"));
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await fetchHandler(new Request("http://localhost/api/reports/nope"))).status, 404);
    });
});
