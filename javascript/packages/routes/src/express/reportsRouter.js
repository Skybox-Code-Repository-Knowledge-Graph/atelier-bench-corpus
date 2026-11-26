/**
 * Express, mounted-router variant: the route is split between the mount
 * prefix (`/api/reports`, in `createReportsApp`) and the router's own path
 * (`/:slug`), so no single string in the file spells the full route.
 */

import express, { Router } from "express";

import { reportPayload } from "../reportPayload.js";

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns {void}
 */
export function showReportRows(req, res) {
    const payload = reportPayload(String(req.params.slug));
    if (payload === undefined) {
        res.status(404).json({ error: "unknown report" });
        return;
    }
    res.json(payload);
}

export const reportsRouter = Router();

reportsRouter.get("/:slug", showReportRows);

/** @returns {import("express").Express} */
export function createReportsApp() {
    const app = express();
    app.use("/api/reports", reportsRouter);
    return app;
}
