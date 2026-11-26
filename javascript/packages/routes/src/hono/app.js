/** Hono: the route and its handler are registered together on one Hono app. */

import { Hono } from "hono";

import { reportPayload } from "../reportPayload.js";

/**
 * @param {import("hono").Context} c
 * @returns {Response}
 */
export function showReportRows(c) {
    const payload = reportPayload(c.req.param("slug") ?? "");
    return payload === undefined ? c.json({ error: "unknown report" }, 404) : c.json(payload);
}

export const app = new Hono();

app.get("/api/reports/:slug", showReportRows);
