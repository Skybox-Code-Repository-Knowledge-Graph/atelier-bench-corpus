/**
 * An import type: `import(...)` written in a type position names a declaration of another module
 * without an import statement, so this file has no runtime edge to the contract it names.
 */

/** The calculator contract, named through an import type. */
export type CalculatorRef = import("../contracts/invoiceCalculator").InvoiceCalculator;

/** The rush calculator when `rush` is set, the standard one otherwise. */
export function chooseCalculator(rush: boolean, standard: CalculatorRef, surcharged: CalculatorRef): CalculatorRef {
    return rush ? surcharged : standard;
}
