/**
 * A template literal pattern index signature (TypeScript 4.4): a key that matches `x-${string}`
 * reads the pattern signature, which is always a string; any other key reads the plain string
 * signature, which may be missing.
 */
export interface TraceHeaders {
    readonly [name: `x-${string}`]: string;
    readonly [name: string]: string | undefined;
}

/** The trace id every bench request carries. */
export function traceId(headers: TraceHeaders): string {
    return headers["x-trace-id"];
}
