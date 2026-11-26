/** Fastify app: routes are registered on the instance with a method call naming the handler. */

import Fastify, { type FastifyInstance } from "fastify";

import { type OrderParams, showOrder } from "./orders";

/** Build the app; tests drive it with inject(), which opens no listener. */
export function buildApp(): FastifyInstance {
    const app = Fastify();

    app.get<OrderParams>("/api/fastify/orders/:reference", showOrder);

    return app;
}
