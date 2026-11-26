/**
 * At the top level of a CommonJS module `this` is `module.exports`, so the
 * assignment below is an export, with no `exports` or `module` written anywhere.
 */

/**
 * @param {number} cents
 * @returns {number}
 */
this.toEuros = function toEuros(cents) {
    return cents / 100;
};
