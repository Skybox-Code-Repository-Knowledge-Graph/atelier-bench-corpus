import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loader } from "@atelier/routes/remix/app/routes/api.reports.$slug.js";

describe("remix", () => {
    it("runs the route module loader for /api/reports/:slug", async () => {
        const response = await loader({ request: new Request("http://localhost/api/reports/gross-profit"), params: { slug: "gross-profit" }, context: {} });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        await assert.rejects(loader({ request: new Request("http://localhost/api/reports/nope"), params: { slug: "nope" }, context: {} }), (thrown) => thrown.status === 404);
    });
});
