/**
 * Function + namespace declaration merging: the namespace adds a member to the function value, so
 * `partCode.separator` is the namespace's const, while `style?.separator` on the same line is the
 * CodeStyle property.
 */

/** How a part code is printed. */
export interface CodeStyle {
    readonly separator: string;
}

/** A part's code: its SKU and its bin, joined by the style's separator or the default one. */
export function partCode(sku: string, bin: string, style?: CodeStyle): string {
    return [sku, bin].join(style?.separator ?? partCode.separator);
}

export namespace partCode {
    /** The separator when no style is given. */
    export const separator = "/";
}
