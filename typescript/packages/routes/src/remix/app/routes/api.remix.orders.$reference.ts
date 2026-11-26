/**
 * Remix route module. The route is the file name under app/routes (flat routes: each dot is a slash,
 * `$reference` a path parameter), so this file serves GET /api/remix/orders/:reference through its
 * `loader` export. Nothing registers it by name.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";

import { routedOrder } from "@atelier/routes/orders";

export async function loader({ params }: LoaderFunctionArgs) {
    const order = routedOrder(params["reference"] ?? "");
    if (order === undefined) {
        throw new Response("not found", { status: 404 });
    }

    return json(order);
}
