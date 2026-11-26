/** Fastify: the route is registered on a server instance that `inject` drives without a listener. */

import Fastify from "fastify";

import { reportPayload } from "../reportPayload.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} reply
 */
export async function showReportRows(request, reply) {
    const { slug } = /** @type {{ slug: string }} */ (request.params);
    const payload = reportPayload(slug);
    if (payload === undefined) {
        return reply.code(404).send({ error: "unknown report" });
    }
    return payload;
}

/** @returns {import("fastify").FastifyInstance} */
export function buildServer() {
    const server = Fastify();
    server.get("/api/reports/:slug", showReportRows);
    return server;
}
