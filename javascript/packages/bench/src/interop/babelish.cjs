/**
 * Transpiler-style CommonJS output: an `__esModule` flag and an `exports.default`.
 * Node ignores the flag, so an ESM default import of this file is the whole
 * exports object and the function is reached as `.default`.
 */

Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @param {{ id: number }} order
 * @returns {string}
 */
exports.default = function describeOrder(order) {
    return `order ${order.id}`;
};
