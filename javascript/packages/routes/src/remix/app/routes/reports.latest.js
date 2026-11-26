/**
 * Remix route module `reports.latest.js` (`/reports/latest`): its loader sends
 * the browser on to the resource route that serves the report rows. The URL is
 * the only link to that route module; Remix maps it back to
 * `api.reports.$slug.js` by the flat-routes file convention.
 */

import { redirect } from "@remix-run/node";

export async function loader() {
    return redirect("/api/reports/gross-profit");
}
