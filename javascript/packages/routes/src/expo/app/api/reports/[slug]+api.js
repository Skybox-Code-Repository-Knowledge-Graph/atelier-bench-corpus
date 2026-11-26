/**
 * Expo Router API route: `app/api/reports/[slug]+api.js` is the route
 * `/api/reports/:slug`, and the exported `GET` serves a GET. The handler
 * receives a web-standard Request plus the matched segments and returns a
 * web-standard Response, so the module needs no Expo import at all.
 */

import { reportPayload } from "../../../../reportPayload.js";

/**
 * @param {Request} _request
 * @param {{ slug: string }} segments
 * @returns {Response}
 */
export function GET(_request, { slug }) {
    const payload = reportPayload(slug);
    if (payload === undefined) {
        return Response.json({ error: "unknown report" }, { status: 404 });
    }
    return Response.json(payload);
}
