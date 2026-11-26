/**
 * Every framework route fixture of @atelier/routes but NestJS (tests/nest.test.ts) is driven here
 * with a URL from src/client.ts, through the framework's own in-process dispatcher where it has
 * one (Hono's app.request, Fastify's inject, h3's web handler) and otherwise by the framework's file
 * convention: the test maps the URL to the module the convention binds it to and calls the export
 * the convention names (Remix `loader`, SvelteKit `GET`, Expo Router `GET`). The answer is the seed:
 * AT-2026-000001 is completed with 120 labour minutes.
 */
import type { RequestEvent } from "@sveltejs/kit";
import { createApp, createRouter, toWebHandler } from "h3";
import { describe, expect, it } from "vitest";

import { RepairStatus } from "@atelier/core";

import { expoOrderUrl, type Fetcher, fetchOrder, nuxtOrderUrl, remixOrderUrl, sveltekitOrderUrl } from "../src/client";
import { GET as expoGet } from "../src/expo/app/api/expo/orders/[reference]+api";
import { buildApp } from "../src/fastify/app";
import { app as honoApp } from "../src/hono/app";
import nuxtHandler from "../src/nuxt/server/api/nuxt/orders/[reference].get";
import { loader } from "../src/remix/app/routes/api.remix.orders.$reference";
import { GET as sveltekitGet } from "../src/sveltekit/src/routes/api/sveltekit/orders/[reference]/+server";

const SEED = { reference: "AT-2026-000001", status: RepairStatus.Completed, laborMinutes: 120 };
const BASE = "http://atelier.test";

/** The parameter a file-convention route binds, read off a URL with the route's own pattern. */
function param(pattern: RegExp, url: string): string {
    const match = pattern.exec(url);
    if (match === null) {
        throw new Error(`${url} does not match ${pattern}`);
    }

    return decodeURIComponent(match[1]!);
}

/** Run a handler that may throw a Response (Remix) or an HttpError (SvelteKit) and answer with a Response. */
async function settle(run: () => Promise<Response> | Response): Promise<Response> {
    try {
        return await run();
    } catch (thrown) {
        if (thrown instanceof Response) {
            return thrown;
        }
        const status = (thrown as { status?: number }).status;
        if (typeof status === "number") {
            return new Response("not found", { status });
        }
        throw thrown;
    }
}

describe("hono route", () => {
    it("serves the seeded order through app.request", async () => {
        const response = await honoApp.request("/api/hono/orders/AT-2026-000001");

        expect(await response.json()).toEqual(SEED);
        expect((await honoApp.request("/api/hono/orders/AT-2026-999999")).status).toBe(404);
    });
});

describe("fastify route", () => {
    it("serves the seeded order through inject", async () => {
        const app = buildApp();
        const response = await app.inject({ method: "GET", url: "/api/fastify/orders/AT-2026-000001" });
        const missing = await app.inject({ method: "GET", url: "/api/fastify/orders/AT-2026-999999" });
        await app.close();

        expect(response.json()).toEqual(SEED);
        expect(missing.statusCode).toBe(404);
    });
});

describe("remix route module", () => {
    const fetcher: Fetcher = (url) => settle(() => loader({ request: new Request(BASE + url), params: { reference: param(/^\/api\/remix\/orders\/([^/]+)$/, url) }, context: {} }));

    it("serves the seeded order from its loader", async () => {
        expect(await fetchOrder(fetcher, remixOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(remixOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("sveltekit endpoint", () => {
    const fetcher: Fetcher = (url) => settle(() => {
        const event = { params: { reference: param(/^\/api\/sveltekit\/orders\/([^/]+)$/, url) }, request: new Request(BASE + url), url: new URL(BASE + url) };

        return sveltekitGet(event as unknown as RequestEvent<{ reference: string }>);
    });

    it("serves the seeded order from its GET export", async () => {
        expect(await fetchOrder(fetcher, sveltekitOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(sveltekitOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("nuxt server route", () => {
    // The path Nuxt derives from server/api/nuxt/orders/[reference].get.ts, registered on h3, the server engine Nuxt runs on.
    const app = createApp().use(createRouter().get("/api/nuxt/orders/:reference", nuxtHandler));
    const web = toWebHandler(app);
    const fetcher: Fetcher = (url) => web(new Request(BASE + url));

    it("serves the seeded order through h3's web handler", async () => {
        expect(await fetchOrder(fetcher, nuxtOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(nuxtOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("expo router api route", () => {
    const fetcher: Fetcher = async (url) => expoGet(new Request(BASE + url), { reference: param(/^\/api\/expo\/orders\/([^/]+)$/, url) });

    it("serves the seeded order from its GET export", async () => {
        expect(await fetchOrder(fetcher, expoOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(expoOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});
