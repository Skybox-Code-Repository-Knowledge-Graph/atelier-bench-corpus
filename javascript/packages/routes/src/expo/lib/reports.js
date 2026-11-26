/**
 * Client helper of the Expo app (outside `app/`, so not a route itself): screens
 * read a report through it. It addresses the API route by URL only; Expo Router
 * serves `/api/reports/:slug` from `app/api/reports/[slug]+api.js`.
 */

/**
 * @param {string} slug
 * @param {(url: string) => Promise<Response>} [fetchImpl]
 * @returns {Promise<Response>}
 */
export function loadReport(slug, fetchImpl = fetch) {
    return fetchImpl(`/api/reports/${slug}`);
}
