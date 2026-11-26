/**
 * SvelteKit endpoint. The route is the directory under src/routes (`[reference]` a path parameter)
 * and `+server.ts` the endpoint file, so this module serves GET /api/sveltekit/orders/:reference
 * through its `GET` export. RequestHandler is imported from the package, not from the generated
 * ./$types, so the module loads without the framework's build step.
 */

import { error, json, type RequestHandler } from "@sveltejs/kit";

import { routedOrder } from "@atelier/routes/orders";

export const GET: RequestHandler<{ reference: string }> = ({ params }) => {
    const order = routedOrder(params.reference);
    if (order === undefined) {
        error(404, "not found");
    }

    return json(order);
};
