/**
 * A typed event map: `on("stock_low", (event) => ...)` infers K from the string argument, and the
 * handler's parameter is the indexed access BenchEventMap[K], so `event.sku` reads the stock_low
 * entry's member and not part_returned's sku on the line above.
 */

/** Every bench event and what it carries. */
export interface BenchEventMap {
    part_returned: { readonly sku: string; readonly bin: string };
    stock_low: { readonly sku: string; readonly onHand: number };
}

type AnyHandler = (event: never) => void;

/** A bench-local event emitter typed by BenchEventMap. */
export class BenchEvents {
    private readonly handlers = new Map<keyof BenchEventMap, AnyHandler[]>();

    on<K extends keyof BenchEventMap>(name: K, handler: (event: BenchEventMap[K]) => void): void {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler as AnyHandler]);
    }

    emit<K extends keyof BenchEventMap>(name: K, event: BenchEventMap[K]): void {
        for (const handler of this.handlers.get(name) ?? []) {
            (handler as (event: BenchEventMap[K]) => void)(event);
        }
    }
}

/** Collect the SKU of every part that runs low. */
export function watchStock(events: BenchEvents, low: string[]): void {
    events.on("stock_low", (event) => low.push(`${event.sku} x${event.onHand}`));
}
