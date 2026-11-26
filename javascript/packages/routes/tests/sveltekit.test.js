import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "@atelier/routes/sveltekit/src/routes/api/reports/[slug]/+server.js";

describe("sveltekit", () => {
    it("runs the +server.js GET handler for /api/reports/[slug]", async () => {
        const response = await GET({ params: { slug: "gross-profit" } });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        await assert.rejects(GET({ params: { slug: "nope" } }), (thrown) => thrown.status === 404);
    });
});
