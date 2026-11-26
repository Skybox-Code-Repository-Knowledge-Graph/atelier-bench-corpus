/**
 * Remix route module (flat-routes convention): the file name
 * `api.reports.$slug.js` is the route `/api/reports/:slug`, and its exported
 * `loader` is the handler Remix runs for a GET.
 */

import { json } from "@remix-run/node";

import { reportPayload } from "../../../reportPayload.js";

/**
 * @param {import("@remix-run/node").LoaderFunctionArgs} args
 */
export async function loader({ params }) {
    const payload = reportPayload(String(params.slug));
    if (payload === undefined) {
        throw json({ error: "unknown report" }, { status: 404 });
    }
    return json(payload);
}
