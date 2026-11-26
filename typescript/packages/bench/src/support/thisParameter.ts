/**
 * A `this` parameter: a standalone function declares the type `this` has inside it. The parameter is
 * erased at compile time, so it exists only for the checker, and `this.bin` resolves into Shelf.
 */

/** A storage shelf on the bench. */
export interface Shelf {
    readonly bin: string;
    readonly capacity: number;
}

/** Called with a shelf as `this`, for example `describeShelf.call(shelf)`. */
export function describeShelf(this: Shelf): string {
    return `${this.bin} holds ${this.capacity} part(s)`;
}
