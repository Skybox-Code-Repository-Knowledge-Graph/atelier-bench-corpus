import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NestFactory } from "@nestjs/core";
import request from "supertest";

import { ReportsModule } from "@atelier/routes/nestjs/reports.controller.js";

describe("nestjs", () => {
    it("serves GET /api/reports/:slug through the controller prefix and the method path", async () => {
        const app = await NestFactory.create(ReportsModule, { logger: false });
        await app.init();
        try {
            const response = await request(app.getHttpServer()).get("/api/reports/gross-profit");
            assert.equal(response.status, 200);
            assert.deepEqual(response.body.rows.map((row) => row.cents), [58325, 46300, 12025]);
            assert.equal((await request(app.getHttpServer()).get("/api/reports/nope")).status, 404);
        } finally {
            await app.close();
        }
    });
});
