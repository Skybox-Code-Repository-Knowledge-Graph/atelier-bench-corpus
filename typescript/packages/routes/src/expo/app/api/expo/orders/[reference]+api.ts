/**
 * Expo Router API route. The route is the file path under app (`[reference]` a path parameter,
 * `+api` an API route), so this module serves GET /api/expo/orders/:reference through its `GET`
 * export, which takes a web Request and the path parameters. It uses web Request / Response only;
 * no Expo package is installed (see the lane README).
 */

import { routedOrder } from "@atelier/routes/orders";

export function GET(_request: Request, { reference }: Record<string, string>): Response {
    const order = routedOrder(reference ?? "");

    return order === undefined ? Response.json({ error: "not found" }, { status: 404 }) : Response.json(order);
}
