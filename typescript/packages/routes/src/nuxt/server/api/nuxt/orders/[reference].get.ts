/**
 * Nuxt server route. The route is the file path under server/api (`[reference]` a path parameter,
 * `.get` the method), so this module serves GET /api/nuxt/orders/:reference through its default
 * export. Nuxt auto-imports the h3 helpers; they are imported from h3 here so the module also loads
 * outside a Nuxt build.
 */

import { createError, defineEventHandler, getRouterParam } from "h3";

import { routedOrder } from "@atelier/routes/orders";

export default defineEventHandler((event) => {
    const order = routedOrder(getRouterParam(event, "reference") ?? "");
    if (order === undefined) {
        throw createError({ statusCode: 404, statusMessage: "not found" });
    }

    return order;
});
