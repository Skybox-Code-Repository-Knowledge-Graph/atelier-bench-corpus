/**
 * CommonJS half of a dual entry point. `require("@atelier/bench/interop/cents-label")`
 * lands here through the "require" condition of this package's exports map; an ESM
 * import of the same specifier lands on ./centsLabel.mjs through the "import" condition.
 */

/**
 * @param {number} cents
 * @returns {string}
 */
exports.centsLabel = function centsLabel(cents) {
    return `${(cents / 100).toFixed(2)} EUR`;
};

exports.FLAVOUR = "require";
