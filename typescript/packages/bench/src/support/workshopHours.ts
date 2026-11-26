/**
 * A namespace import alias: `import Hours = Workshop.Hours` binds a local name to a nested namespace
 * (an import-equals declaration, which only TypeScript has). Hours.BENCH_DAY resolves through the
 * alias into the namespace member.
 */

/** Opening hours of the workshop, per kind of day. */
export namespace Workshop {
    export namespace Hours {
        export const BENCH_DAY = 8;
        export const RUSH_DAY = 10;
    }
}

import Hours = Workshop.Hours;

/** Bench hours available over a number of standard days. */
export function benchHours(days: number): number {
    return days * Hours.BENCH_DAY;
}
