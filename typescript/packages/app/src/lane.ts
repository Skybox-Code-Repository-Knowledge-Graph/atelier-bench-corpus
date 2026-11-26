/** The lane name the build injects: declared in types/lane.d.ts, defined in vitest.config.ts. */
export function laneName(): string {
    return __ATELIER_LANE__;
}
