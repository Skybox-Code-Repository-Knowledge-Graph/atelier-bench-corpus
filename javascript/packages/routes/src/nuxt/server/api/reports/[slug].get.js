/**
 * Nuxt server route: `server/api/reports/[slug].get.js` is the route
 * `GET /api/reports/:slug`. The default export is the handler; Nuxt
 * auto-imports h3's helpers, and this file imports them from h3, Nuxt's
 * server engine, explicitly, so it also loads outside a Nuxt build.
 */

import { createError, defineEventHandler, getRouterParam } from "h3";

import { reportPayload } from "../../../../reportPayload.js";

export default defineEventHandler((event) => {
    const payload = reportPayload(getRouterParam(event, "slug") ?? "");
    if (payload === undefined) {
        throw createError({ statusCode: 404, statusMessage: "unknown report" });
    }
    return payload;
});
