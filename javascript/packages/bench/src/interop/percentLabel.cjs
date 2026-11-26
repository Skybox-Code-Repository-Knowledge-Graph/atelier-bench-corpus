/**
 * A module whose exports object is a function, with a second function hung on it
 * as a property: `require(...)` is callable and also carries `fromRatio`.
 */

/**
 * @param {number} basisPoints
 * @returns {string}
 */
module.exports = function percentLabel(basisPoints) {
    return `${(basisPoints / 100).toFixed(2)}%`;
};

/**
 * @param {number} ratio
 * @returns {string}
 */
module.exports.fromRatio = function fromRatio(ratio) {
    return module.exports(Math.round(ratio * 10000));
};
