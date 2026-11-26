/**
 * The one body every framework route module in this package serves:
 * `GET /api/reports/:slug` answers the registered report's rows over the
 * seeded dataset, or nothing for an unknown slug. Each route module wraps it
 * in its own framework's handler shape.
 */

import bench from "@atelier/bench";
import { seededState } from "@atelier/app";

const { report: findReport } = bench;

/**
 * @typedef {object} ReportPayload
 * @property {string} slug
 * @property {readonly { label: string, value: number, cents?: number }[]} rows
 */

/**
 * @param {string} slug
 * @returns {ReportPayload | undefined}
 */
export function reportPayload(slug) {
    const entry = findReport(slug);
    if (entry === undefined) {
        return undefined;
    }

    return { slug, rows: entry.rows(seededState().data) };
}
