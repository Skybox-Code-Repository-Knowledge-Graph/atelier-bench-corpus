/**
 * SvelteKit universal load for the page `/reports/[slug]`: it reads the rows
 * from the app's own endpoint by URL. SvelteKit routes that URL to
 * `src/routes/api/reports/[slug]/+server.js` by its directory convention.
 */

/**
 * @param {{ params: { slug: string }, fetch: (url: string) => Promise<Response> }} event
 */
export async function load({ params, fetch }) {
    const response = await fetch(`/api/reports/${params.slug}`);
    return { report: await response.json() };
}
