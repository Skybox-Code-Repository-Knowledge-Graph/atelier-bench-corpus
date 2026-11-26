/**
 * An export that is a getter on the exports object: `vatRateBp` has no assignment
 * and no declaration, only the property Object.defineProperty installs.
 */

Object.defineProperty(exports, "vatRateBp", {
    enumerable: true,
    get() {
        return 2100;
    },
});
