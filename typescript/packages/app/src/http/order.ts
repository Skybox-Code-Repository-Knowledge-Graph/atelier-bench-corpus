/** One order as JSON, served through the mounted order router. */

import type { Request, Response } from "express";

import { NotFoundError } from "@atelier/core";

import type { AppState } from "../state";

/** Handler factory for `GET /api/orders/:reference`. */
export function showOrder(state: AppState) {
    return (req: Request, res: Response): void => {
        const reference = String(req.params["reference"]);
        const order = state.data.orders.find((candidate) => candidate.reference() === reference);
        if (order === undefined) {
            throw new NotFoundError("repair order", reference);
        }

        res.json({ reference, status: order.status, laborMinutes: order.laborMinutes });
    };
}
