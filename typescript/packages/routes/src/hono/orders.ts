/** Hono handler for one order. */

import type { Context } from "hono";

import { routedOrder } from "@atelier/routes/orders";

/** `GET /api/hono/orders/:reference`. */
export function showOrder(c: Context): Response {
    const order = routedOrder(c.req.param("reference") ?? "");

    return order === undefined ? c.json({ error: "not found" }, 404) : c.json(order);
}
