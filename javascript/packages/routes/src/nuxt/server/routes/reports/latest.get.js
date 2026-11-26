/**
 * Nuxt server route `server/routes/reports/latest.get.js` (`GET /reports/latest`):
 * it redirects to the API route by URL; Nitro maps `/api/reports/:slug` to
 * `server/api/reports/[slug].get.js` by the file convention.
 */

import { defineEventHandler, sendRedirect } from "h3";

export default defineEventHandler((event) => sendRedirect(event, "/api/reports/gross-profit", 302));
