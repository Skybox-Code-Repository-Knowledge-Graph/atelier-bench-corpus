/**
 * SvelteKit endpoint: the directory path `src/routes/api/reports/[slug]` is
 * the route `/api/reports/:slug`, and `+server.js` exports one handler per
 * HTTP method; `GET` serves a GET.
 */

import { error, json } from "@sveltejs/kit";

import { reportPayload } from "../../../../../../reportPayload.js";

/**
 * @param {{ params: { slug: string } }} event
 * @returns {Promise<Response>}
 */
export async function GET({ params }) {
    const payload = reportPayload(params.slug);
    if (payload === undefined) {
        error(404, "unknown report");
    }
    return json(payload);
}
