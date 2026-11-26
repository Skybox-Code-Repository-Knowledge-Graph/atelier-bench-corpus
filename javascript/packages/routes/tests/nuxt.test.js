import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createApp, createRouter, toWebHandler } from "h3";
import { createNitro, scanHandlers } from "nitropack";

const SERVER_DIR = fileURLToPath(new URL("../src/nuxt/server/", import.meta.url));

/**
 * The routes Nitro (Nuxt's server engine) reads off the server/ file names with its own
 * scanner, each served through h3 the way Nitro's runtime serves it.
 */
async function nitroRoutes() {
    const nitro = await createNitro({ rootDir: SERVER_DIR, srcDir: SERVER_DIR, dev: false, preset: "node-server", logLevel: 0, compatibilityDate: "2026-11-26" });
    const scanned = await scanHandlers(nitro);
    await nitro.close();
    const router = createRouter();
    for (const entry of scanned) {
        router.use(entry.route, (await import(pathToFileURL(entry.handler).href)).default, entry.method);
    }
    return { scanned, fetchHandler: toWebHandler(createApp().use(router)) };
}

describe("nuxt (nitro server routes)", () => {
    it("routes GET /api/reports/:slug to server/api/reports/[slug].get.js by its file name", async () => {
        const { scanned, fetchHandler } = await nitroRoutes();
        const routes = scanned.map((entry) => `${entry.method} ${entry.route} ${entry.handler.split("/src/nuxt/")[1]}`).sort();
        assert.deepEqual(routes, [
            "get /api/reports/:slug server/api/reports/[slug].get.js",
            "get /reports/latest server/routes/reports/latest.get.js",
        ]);
        const response = await fetchHandler(new Request("http://localhost/api/reports/gross-profit"));
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
        assert.equal((await fetchHandler(new Request("http://localhost/api/reports/nope"))).status, 404);
    });

    it("follows /reports/latest to the API route by URL", async () => {
        const { fetchHandler } = await nitroRoutes();
        const redirected = await fetchHandler(new Request("http://localhost/reports/latest"));
        assert.equal(redirected.status, 302);
        const location = String(redirected.headers.get("location"));
        assert.equal(location, "/api/reports/gross-profit");
        const response = await fetchHandler(new Request(new URL(location, "http://localhost")));
        assert.deepEqual((await response.json()).rows.map((row) => row.cents), [58325, 46300, 12025]);
    });
});
