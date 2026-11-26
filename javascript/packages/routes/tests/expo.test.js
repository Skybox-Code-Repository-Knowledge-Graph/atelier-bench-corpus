import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "@atelier/routes/expo/app/api/reports/[slug]+api.js";
import { loadReport } from "@atelier/routes/expo/lib/reports.js";

describe("expo router api route", () => {
    it("runs the +api.js GET handler for /api/reports/[slug]", async () => {
        const response = GET(new Request("http://localhost/api/reports/gross-profit"), { slug: "gross-profit" });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal(GET(new Request("http://localhost/api/reports/nope"), { slug: "nope" }).status, 404);
    });

    it("reads a report through the client helper, by URL", async () => {
        const requested = [];
        /** Expo Router serves /api/reports/[slug] from the +api.js file; this fetch routes it the same way. */
        const fetchImpl = async (url) => {
            requested.push(url);
            return GET(new Request(new URL(url, "http://localhost")), { slug: String(url.split("/").at(-1)) });
        };
        const response = await loadReport("gross-profit", fetchImpl);
        assert.deepEqual(requested, ["/api/reports/gross-profit"]);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
    });
});
