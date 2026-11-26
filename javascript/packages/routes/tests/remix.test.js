import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loader } from "@atelier/routes/remix/app/routes/api.reports.$slug.js";
import { loader as latestLoader } from "@atelier/routes/remix/app/routes/reports.latest.js";

describe("remix", () => {
    it("runs the resource route loader for /api/reports/:slug", async () => {
        const response = await loader({ request: new Request("http://localhost/api/reports/gross-profit"), params: { slug: "gross-profit" }, context: {} });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        await assert.rejects(loader({ request: new Request("http://localhost/api/reports/nope"), params: { slug: "nope" }, context: {} }), (thrown) => thrown.status === 404);
    });

    it("follows the /reports/latest redirect to the resource route by URL", async () => {
        const redirected = await latestLoader();
        assert.equal(redirected.status, 302);
        const location = String(redirected.headers.get("Location"));
        assert.equal(location, "/api/reports/gross-profit");
        const slug = String(location.split("/").at(-1));
        const response = await loader({ request: new Request(new URL(location, "http://localhost")), params: { slug }, context: {} });
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
    });
});
