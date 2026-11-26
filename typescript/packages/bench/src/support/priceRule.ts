/**
 * A contract written as an object type alias, not an interface. TypeScript lets a class name a type
 * alias in its `implements` clause, so the three classes below implement PriceRule although no
 * interface declares it.
 */

/** One price adjustment, in cents. */
export type PriceRule = {
    readonly name: string;
    apply(cents: number): number;
};

/** Adds a fixed amount. */
export class FlatSurcharge implements PriceRule {
    readonly name = "flat-surcharge";

    constructor(private readonly amount: number) {}

    apply(cents: number): number {
        return cents + this.amount;
    }
}

/** Takes a whole-number percentage off, rounded to the cent. */
export class PercentDiscount implements PriceRule {
    readonly name = "percent-discount";

    constructor(private readonly percent: number) {}

    apply(cents: number): number {
        return Math.round((cents * (100 - this.percent)) / 100);
    }
}

/** Leaves the price as it is. */
export class NoAdjustment implements PriceRule {
    readonly name = "no-adjustment";

    apply(cents: number): number {
        return cents;
    }
}

/** Apply every rule in order, each to the result of the one before. */
export function applyRules(rules: readonly PriceRule[], cents: number): number {
    return rules.reduce((total, rule) => rule.apply(total), cents);
}
