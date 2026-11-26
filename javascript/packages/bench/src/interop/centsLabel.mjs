/**
 * ESM half of a dual entry point: the "import" condition of the package's exports map
 * sends `import ... from "@atelier/bench/interop/cents-label"` here; a require of the
 * same specifier gets ./centsLabel.cjs. The package's only ES module.
 */

/**
 * @param {number} cents
 * @returns {string}
 */
export function centsLabel(cents) {
    return `${(cents / 100).toFixed(2)} EUR`;
}

export const FLAVOUR = "import";
