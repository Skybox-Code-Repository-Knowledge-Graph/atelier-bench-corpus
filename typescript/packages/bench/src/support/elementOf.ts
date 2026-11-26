/**
 * `infer` declares a type variable inside the extends clause of a conditional type, and the true
 * branch reads it. The variable has no declaration anywhere else.
 */

/** The element type of a readonly array type, or never. */
export type ElementOf<T> = T extends readonly (infer Item)[]
    ? Item
    : never;
