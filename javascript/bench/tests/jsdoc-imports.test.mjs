// Every name a JSDoc `@import` tag binds is used by a JSDoc type in the same file.
//
// A JSDoc import creates no runtime binding, so nothing at run time notices a stale one, and
// tsc reads only packages/*/src: a test file's `@type {RenamedAlias}` would stay green. This
// walk parses every lane source file (tests included) with the pinned TypeScript parser and
// fails on an `@import` name that no other line of the file mentions.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function laneFiles() {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== "fixtures") walk(full);
            } else if (/\.(c|m)?js$/.test(entry.name)) {
                files.push(full);
            }
        }
    };
    walk(join(LANE_ROOT, "packages"));
    return files.sort();
}

/** [{ name, line }] for every name bound by a JSDoc @import tag in the file. */
export function jsdocImportNames(file, text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
    const names = [];
    const visit = (node) => {
        if (ts.isJSDocImportTag(node) && node.importClause) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
            const clause = node.importClause;
            if (clause.name) names.push({ name: clause.name.text, line });
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.push({ name: element.name.text, line });
            if (bindings && ts.isNamespaceImport(bindings)) names.push({ name: bindings.name.text, line });
        }
        for (const doc of node.jsDoc ?? []) visit(doc);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return names;
}

/** Line indexes (0-based) of JSDoc comment lines outside an @import tag, as [{ index, content }]. */
function jsdocTypeLines(file, text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
    const importLines = new Set();
    const lines = [];
    const visit = (node) => {
        if (ts.isJSDocImportTag(node)) {
            const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
            const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
            for (let index = first; index <= last; index++) importLines.add(index);
        }
        for (const doc of node.jsDoc ?? []) {
            const first = source.getLineAndCharacterOfPosition(doc.getStart(source)).line;
            const last = source.getLineAndCharacterOfPosition(doc.getEnd()).line;
            for (let index = first; index <= last; index++) lines.push(index);
        }
        for (const doc of node.jsDoc ?? []) visit(doc);
        ts.forEachChild(node, visit);
    };
    visit(source);
    const rows = text.split("\n");
    return [...new Set(lines)].filter((index) => !importLines.has(index)).map((index) => ({ index, content: rows[index] }));
}

/** @import names that no JSDoc type (a `{...}` in a JSDoc comment, outside the @import tag) mentions. */
export function unusedJsdocImports(file, text) {
    const typeLines = jsdocTypeLines(file, text);
    return jsdocImportNames(file, text).filter(({ name }) => {
        const word = new RegExp(`\\{[^\\n]*(?<![A-Za-z0-9_$])${name.replace(/\$/g, "\\$")}(?![A-Za-z0-9_$])`);
        return !typeLines.some(({ content }) => word.test(content));
    });
}

describe("jsdoc @import tags", () => {
    it("flags a bound name nothing else in the file uses", () => {
        const stale = "/** @import { Formatter as BillingFormatter } from \"x\" */\n/** @type {BillingFormatterX} */\nconst money = 1;\n";
        assert.deepEqual(unusedJsdocImports("a.js", stale).map((entry) => entry.name), ["BillingFormatter"]);
        assert.deepEqual(unusedJsdocImports("a.js", stale.replace("BillingFormatterX", "BillingFormatter")), []);
    });

    it("does not count a plain comment mention as a use", () => {
        const used = "/** @import { Formatter as BillingFormatter } from \"x\" */\n/** @type {BillingFormatter} */\nconst money = 1;\n";
        assert.deepEqual(unusedJsdocImports("a.js", used), []);
        assert.deepEqual(unusedJsdocImports("a.js", used.replace("/** @type {BillingFormatter} */", "// BillingFormatter")).map((entry) => entry.name), ["BillingFormatter"]);
    });

    it("finds a use for every @import name in the lane", () => {
        const found = [];
        const unused = [];
        for (const file of laneFiles()) {
            const text = readFileSync(file, "utf8");
            const rel = relative(LANE_ROOT, file).split(sep).join("/");
            found.push(...jsdocImportNames(file, text).map(({ name }) => `${rel}: ${name}`));
            unused.push(...unusedJsdocImports(file, text).map(({ name }) => `${rel}: ${name}`));
        }
        assert.ok(found.length >= 2, `expected the lane's @import tags, found ${found.join(", ")}`);
        assert.deepEqual(unused, []);
    });
});
