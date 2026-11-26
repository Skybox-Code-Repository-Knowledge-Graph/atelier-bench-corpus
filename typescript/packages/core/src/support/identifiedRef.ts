/**
 * An import type: `import(...)` written in a type position names a declaration of another module
 * without an import statement, so this file has no runtime edge to the interface it names.
 */

/** Anything addressable by a numeric id, named through an import type. */
export type IdentifiedRef = import("../contracts/repository").Identified;

/** The ids of the given records, in order. */
export function idsOf(records: readonly IdentifiedRef[]): number[] {
    return records.map((record) => record.id);
}
