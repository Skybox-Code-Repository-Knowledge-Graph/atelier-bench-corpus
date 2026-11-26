/** Fastify handler for one order. */

import type { FastifyReply, FastifyRequest } from "fastify";

import { routedOrder, type RoutedOrder } from "@atelier/routes/orders";

/** Route generic: the path parameter the handler reads. */
export interface OrderParams {
    Params: { reference: string };
}

/** `GET /api/fastify/orders/:reference`. */
export async function showOrder(request: FastifyRequest<OrderParams>, reply: FastifyReply): Promise<RoutedOrder | undefined> {
    const order = routedOrder(request.params.reference);
    if (order === undefined) {
        await reply.code(404).send({ error: "not found" });

        return undefined;
    }

    return order;
}
