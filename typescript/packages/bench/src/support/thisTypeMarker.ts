/**
 * `ThisType<T>` in an object literal's contextual type: the checker types `this` inside the
 * literal's methods as T (a marker interface with no members of its own), so `this.capacity` reads
 * BayState, not a property of the literal.
 */

/** What a bay's methods read through `this`. */
export interface BayState {
    readonly capacity: number;
    readonly used: number;
}

/** A bay's methods. */
export interface BayMethods {
    free(): number;
}

/** Called with a bay as `this`, for example `bayMethods.free.call(bay)`. */
export const bayMethods: BayMethods & ThisType<BayState> = {
    free() {
        return this.capacity - this.used;
    },
};
