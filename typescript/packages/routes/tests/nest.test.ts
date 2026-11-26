/**
 * The NestJS controller, driven request-level through the Fastify adapter's inject() (no listener)
 * with the URL src/client.ts builds. The answer is the seed: AT-2026-000001 is completed with 120
 * labour minutes. Type-checked by src/nest/tsconfig.json, which turns on legacy decorators.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { RepairStatus } from "@atelier/core";

import { type Fetcher, fetchOrder, nestOrderUrl } from "../src/client";
import { createNestApp } from "../src/nest/app";

describe("nestjs controller", () => {
    let app: NestFastifyApplication;
    const fetcher: Fetcher = async (url) => {
        const reply = await app.inject({ method: "GET", url });

        return new Response(reply.body, { status: reply.statusCode, headers: { "content-type": String(reply.headers["content-type"] ?? "") } });
    };

    beforeAll(async () => {
        app = await createNestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it("serves the seeded order through the decorated controller method", async () => {
        expect(await fetchOrder(fetcher, nestOrderUrl("AT-2026-000001"))).toEqual({ reference: "AT-2026-000001", status: RepairStatus.Completed, laborMinutes: 120 });
        expect((await fetcher(nestOrderUrl("AT-2026-999999"))).status).toBe(404);
    });
});
