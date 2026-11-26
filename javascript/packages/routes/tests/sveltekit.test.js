import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "@atelier/routes/sveltekit/src/routes/api/reports/[slug]/+server.js";
import { load } from "@atelier/routes/sveltekit/src/routes/reports/[slug]/+page.js";

describe("sveltekit", () => {
    it("runs the +server.js GET handler for /api/reports/[slug]", async () => {
        const response = await GET({ params: { slug: "gross-profit" } });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        await assert.rejects(GET({ params: { slug: "nope" } }), (thrown) => thrown.status === 404);
    });

    it("loads the /reports/[slug] page through the endpoint URL", async () => {
        const requested = [];
        /** SvelteKit hands load a fetch that routes its own URLs; this one routes /api/reports/[slug] the same way. */
        const fetch = async (url) => {
            requested.push(url);
            return GET({ params: { slug: String(url.split("/").at(-1)) } });
        };
        const { report } = await load({ params: { slug: "gross-profit" }, fetch });
        assert.deepEqual(requested, ["/api/reports/gross-profit"]);
        assert.deepEqual(report.rows.map((row) => row.cents), [58325, 46300, 12025]);
    });
});
