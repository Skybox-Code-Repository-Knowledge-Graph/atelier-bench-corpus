/**
 * Exports replaced after the fact. The `exports.formatCents` assignment is made on the
 * original exports object, which the later `module.exports =` drops: a consumer's
 * formatCents is formatCentsFixed, the function the final exports object carries.
 */

/**
 * @param {number} cents
 * @returns {string}
 */
exports.formatCents = function formatCents(cents) {
    return String(cents);
};

/**
 * @param {number} cents
 * @returns {string}
 */
function formatCentsFixed(cents) {
    return (cents / 100).toFixed(2);
}

module.exports = { formatCents: formatCentsFixed };
