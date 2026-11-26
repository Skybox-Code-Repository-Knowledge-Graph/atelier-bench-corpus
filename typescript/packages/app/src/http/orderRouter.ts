/**
 * An express Router, the other registration shape: routes are registered on the router with paths
 * relative to where the app mounts it. createApp mounts it at /api/orders, so the "/:reference"
 * route below serves GET /api/orders/:reference.
 */

import { Router } from "express";

import { showOrder } from "./order";
import type { AppState } from "../state";

/** The order router, bound to one state. */
export function orderRouter(state: AppState): Router {
    const router = Router();

    router.get("/:reference", showOrder(state));

    return router;
}
