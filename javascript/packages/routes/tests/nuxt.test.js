import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, createRouter, toWebHandler } from "h3";

import reportHandler from "@atelier/routes/nuxt/server/api/reports/[slug].get.js";
import latestHandler from "@atelier/routes/nuxt/server/routes/reports/latest.get.js";

/** The router Nitro builds from the two file names. */
function nitroLikeHandler() {
    const router = createRouter().get("/api/reports/:slug", reportHandler).get("/reports/latest", latestHandler);
    return toWebHandler(createApp().use(router));
}

describe("nuxt (h3 server routes)", () => {
    it("serves GET /api/reports/:slug, routed the way the file name says", async () => {
        const fetchHandler = nitroLikeHandler();
        const response = await fetchHandler(new Request("http://localhost/api/reports/gross-profit"));
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await fetchHandler(new Request("http://localhost/api/reports/nope"))).status, 404);
    });

    it("follows /reports/latest to the API route by URL", async () => {
        const fetchHandler = nitroLikeHandler();
        const redirected = await fetchHandler(new Request("http://localhost/reports/latest"));
        assert.equal(redirected.status, 302);
        const location = String(redirected.headers.get("location"));
        assert.equal(location, "/api/reports/gross-profit");
        const response = await fetchHandler(new Request(new URL(location, "http://localhost")));
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
    });
});
