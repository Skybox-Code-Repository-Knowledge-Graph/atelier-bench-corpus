// ESM consumers of CommonJS export forms, resolved by Node's ESM/CJS interop.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import babelish from "@atelier/bench/interop/babelish.cjs";
import { centsLabel, FLAVOUR } from "@atelier/bench/interop/cents-label";

describe("esm consumers of commonjs", () => {
    it("takes the import condition of the exports map", () => {
        assert.equal(FLAVOUR, "import");
        assert.equal(centsLabel(58325), "583.25 EUR");
    });

    it("resolves the specifier to the ES module file", () => {
        assert.ok(import.meta.resolve("@atelier/bench/interop/cents-label").endsWith("centsLabel.mjs"));
    });

    it("ignores __esModule: the default import is the whole exports object", () => {
        assert.equal(babelish.__esModule, true);
        assert.equal(typeof babelish, "object");
        assert.equal(babelish.default({ id: 7 }), "order 7");
    });
});
