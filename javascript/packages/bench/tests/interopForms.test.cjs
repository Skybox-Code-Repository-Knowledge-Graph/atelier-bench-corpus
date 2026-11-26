// CommonJS export forms a consumer reaches only through Node's module semantics.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { centsLabel, FLAVOUR } = require("@atelier/bench/interop/cents-label");
const { formatCents } = require("@atelier/bench/interop/exportsReset.cjs");
const moduleThis = require("@atelier/bench/interop/moduleThis.cjs");
const lazy = require("@atelier/bench/interop/lazyExport.cjs");
const percentLabel = require("@atelier/bench/interop/percentLabel.cjs");

describe("commonjs export forms", () => {
    it("takes the require condition of the exports map", () => {
        assert.equal(FLAVOUR, "require");
        assert.ok(require.resolve("@atelier/bench/interop/cents-label").endsWith("centsLabel.cjs"));
        assert.equal(centsLabel(12025), "120.25 EUR");
    });

    it("keeps only what the final module.exports carries", () => {
        assert.equal(formatCents(12025), "120.25");
    });

    it("exports through this at module scope", () => {
        assert.equal(moduleThis.toEuros(12025), 120.25);
    });

    it("exports a getter installed on exports", () => {
        assert.equal(lazy.vatRateBp, 2100);
        assert.equal(typeof Object.getOwnPropertyDescriptor(lazy, "vatRateBp")?.get, "function");
    });

    it("exports a callable module with a property", () => {
        assert.equal(percentLabel(2500), "25.00%");
        assert.equal(percentLabel.fromRatio(0.25), "25.00%");
    });
});
