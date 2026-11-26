/**
 * A small client for the route fixtures: it addresses each framework's order route by its URL and
 * fetches it through whatever fetcher it is given (the tests pass each framework's in-process
 * dispatcher, so no network listener is opened).
 */

import type { RoutedOrder } from "./orders";

/** Anything that turns a URL into a response. */
export type Fetcher = (url: string) => Promise<Response>;

/** The NestJS controller's order route. */
export const nestOrderUrl = (reference: string): string => `/api/nest/orders/${encodeURIComponent(reference)}`;

/** The Remix route module's order route. */
export const remixOrderUrl = (reference: string): string => `/api/remix/orders/${encodeURIComponent(reference)}`;

/** The SvelteKit endpoint's order route. */
export const sveltekitOrderUrl = (reference: string): string => `/api/sveltekit/orders/${encodeURIComponent(reference)}`;

/** The Nuxt server route's order route. */
export const nuxtOrderUrl = (reference: string): string => `/api/nuxt/orders/${encodeURIComponent(reference)}`;

/** The Expo Router API route's order route. */
export const expoOrderUrl = (reference: string): string => `/api/expo/orders/${encodeURIComponent(reference)}`;

/** GET `url` and decode the order; throws on any status but 2xx. */
export async function fetchOrder(fetcher: Fetcher, url: string): Promise<RoutedOrder> {
    const response = await fetcher(url);
    if (!response.ok) {
        throw new Error(`GET ${url}: ${response.status}`);
    }

    return (await response.json()) as RoutedOrder;
}
