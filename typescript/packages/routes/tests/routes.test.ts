/**
 * Every framework route fixture of @atelier/routes but NestJS (tests/nest.test.ts) is driven here
 * with a URL from src/client.ts, through the framework's own in-process dispatcher where it has
 * one (Hono's app.request, Fastify's inject; Nuxt's routes come from Nitro's own scanner over the
 * server/ directory, served on h3) and otherwise by the framework's file convention: the test
 * derives each route's URL pattern from its module's path under the framework's naming rule, reads
 * the URL against it and calls the export the convention names (Remix `loader`, SvelteKit `GET`,
 * Expo Router `GET`). The answer is the seed: AT-2026-000001 is completed with 120 labour minutes.
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RequestEvent } from "@sveltejs/kit";
import { createApp, createRouter, type RouterMethod, toWebHandler } from "h3";
import { createNitro, scanHandlers } from "nitropack";
import { beforeAll, describe, expect, it } from "vitest";

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

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** `[name]` path segments (SvelteKit, Nuxt, Expo Router) are parameters. */
const bracketParams = (path: string): string => path.replace(/\[([^\]/]+)\]/g, ":$1");

/** Remix flat routes: app/routes/<name>.ts, each dot a slash, a `$name` segment a parameter. */
function remixPath(file: string): string | undefined {
    const name = /^app\/routes\/(.+)\.tsx?$/.exec(file)?.[1];

    return name === undefined ? undefined : `/${name.split(".").map((segment) => (segment.startsWith("$") ? `:${segment.slice(1)}` : segment)).join("/")}`;
}

/** SvelteKit: the directory of a `+server.ts` under src/routes is the path. */
function sveltekitPath(file: string): string | undefined {
    const dir = /^src\/routes\/(.+)\/\+server\.ts$/.exec(file)?.[1];

    return dir === undefined ? undefined : bracketParams(`/${dir}`);
}

/** Expo Router: app/<path>+api.ts serves /<path>. */
function expoPath(file: string): string | undefined {
    const path = /^app\/(.+)\+api\.ts$/.exec(file)?.[1];

    return path === undefined ? undefined : bracketParams(`/${path}`);
}

/**
 * The route a file-convention framework derives from the one route module under src/<framework>:
 * the module's path through the framework's naming rule gives the URL pattern, and `params` reads a
 * URL against that pattern (it throws when the module's path does not serve the URL), so the
 * URL-to-file binding the `route_url` keys rest on is derived here, never written by hand.
 */
function conventionRoute(framework: string, derive: (file: string) => string | undefined) {
    const root = join(SRC, framework);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" })
        .map((entry) => entry.split(sep).join("/"))
        .filter((entry) => derive(entry) !== undefined);
    if (files.length !== 1) {
        throw new Error(`src/${framework} holds ${files.length} route modules under its convention, expected 1: ${files.join(", ")}`);
    }
    const file = files[0]!;
    const pattern = derive(file)!;
    const names: string[] = [];
    const source = pattern.split("/").map((segment) => {
        if (!segment.startsWith(":")) {
            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
        names.push(segment.slice(1));

        return "([^/]+)";
    }).join("/");
    const regex = new RegExp(`^${source}$`);

    return {
        absolute: join(root, file),
        pattern,
        params(url: string): Record<string, string> {
            const match = regex.exec(new URL(url, BASE).pathname);
            if (match === null) {
                throw new Error(`${url} is not served by src/${framework}/${file} (${pattern})`);
            }

            return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)]));
        },
    };
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
    const route = conventionRoute("remix", remixPath);
    const fetcher: Fetcher = (url) => settle(() => loader({ request: new Request(BASE + url), params: route.params(url), context: {} }));

    it("binds its URL to the one route module of the remix directory", async () => {
        expect(route.pattern).toBe("/api/remix/orders/:reference");
        expect((await import(route.absolute)).loader).toBe(loader);
    });

    it("serves the seeded order from its loader", async () => {
        expect(await fetchOrder(fetcher, remixOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(remixOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("sveltekit endpoint", () => {
    const route = conventionRoute("sveltekit", sveltekitPath);
    const fetcher: Fetcher = (url) => settle(() => {
        const event = { params: route.params(url), request: new Request(BASE + url), url: new URL(BASE + url) };

        return sveltekitGet(event as unknown as RequestEvent<{ reference: string }>);
    });

    it("binds its URL to the one route module of the sveltekit directory", async () => {
        expect(route.pattern).toBe("/api/sveltekit/orders/:reference");
        expect((await import(route.absolute)).GET).toBe(sveltekitGet);
    });

    it("serves the seeded order from its GET export", async () => {
        expect(await fetchOrder(fetcher, sveltekitOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(sveltekitOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("nuxt server route", () => {
    // Nitro, the server engine Nuxt runs on, reads the routes off the server/ file names with its own
    // scanner; each is then served through h3 the way Nitro's runtime serves it.
    const serverDir = join(SRC, "nuxt", "server");
    let scanned: Awaited<ReturnType<typeof scanHandlers>> = [];
    let web: (request: Request) => Promise<Response>;
    const fetcher: Fetcher = (url) => web(new Request(BASE + url));

    beforeAll(async () => {
        const nitro = await createNitro({ rootDir: serverDir, srcDir: serverDir, dev: false, preset: "node-server", logLevel: 0, compatibilityDate: "2026-11-26" });
        scanned = await scanHandlers(nitro);
        await nitro.close();
        const router = createRouter();
        for (const entry of scanned) {
            router.use(entry.route!, (await import(entry.handler)).default, entry.method as RouterMethod);
        }
        web = toWebHandler(createApp().use(router));
    });

    it("binds its URL to the one route module Nitro scans under server/", async () => {
        const routes = scanned.map((entry) => `${entry.method} ${entry.route} ${relative(SRC, entry.handler).split(sep).join("/")}`);

        expect(routes).toEqual(["get /api/nuxt/orders/:reference nuxt/server/api/nuxt/orders/[reference].get.ts"]);
        expect((await import(scanned[0]!.handler)).default).toBe(nuxtHandler);
    });

    it("serves the seeded order through Nitro's routes on h3", async () => {
        expect(await fetchOrder(fetcher, nuxtOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(nuxtOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});

describe("expo router api route", () => {
    const route = conventionRoute("expo", expoPath);
    const fetcher: Fetcher = async (url) => expoGet(new Request(BASE + url), route.params(url));

    it("binds its URL to the one route module of the expo directory", async () => {
        expect(route.pattern).toBe("/api/expo/orders/:reference");
        expect((await import(route.absolute)).GET).toBe(expoGet);
    });

    it("serves the seeded order from its GET export", async () => {
        expect(await fetchOrder(fetcher, expoOrderUrl("AT-2026-000001"))).toEqual(SEED);
        expect((await fetcher(expoOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});
