// Every module specifier written anywhere in the javascript lane must resolve.
//
// "Written" means: a static `import ... from` / `export ... from` / side-effect
// `import`, a dynamic `import()` call, a `require()` / `require.resolve()` call,
// a JSDoc type `import()` and a JSDoc `@import { X } from "..."` tag (type-only and docblock-only specifiers, which no
// runtime ever loads and node --check never reads). The walk covers every
// .js/.cjs/.mjs file under the lane root except node_modules: packages/*/src,
// packages/*/tests, bench/ and the broken-syntax fixtures (which still parse far
// enough for their specifiers to be read). Prose in comments, such as a backticked
// example of how another file requires this one, is not a specifier and is not read:
// the TypeScript parser (the lane's own pinned typescript devDependency) only yields
// a JSDoc import() when it sits in a type expression.
//
// Resolution follows the runtime semantics of the syntax:
// - ESM (static import/export, dynamic import(), and type import() in an ESM file):
//   a relative specifier must name an existing file exactly as written (no extension
//   probing, no directory index); a bare one goes through node's ESM resolver.
// - CommonJS (require, require.resolve, and type import() in a CommonJS file):
//   node's CommonJS resolver, from the file that writes it.
// - A template-literal require such as require(`./reports/${slug}.cjs`) must match
//   at least one file.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function laneFiles() {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== ".git") walk(full);
            } else if (/\.(c|m)?js$/.test(entry.name)) {
                files.push(full);
            }
        }
    };
    walk(LANE_ROOT);
    return files.sort();
}

/** "esm" or "cjs", the way node decides it: extension first, then the nearest package.json "type". */
function moduleFormat(file) {
    if (file.endsWith(".mjs")) return "esm";
    if (file.endsWith(".cjs")) return "cjs";
    for (let dir = dirname(file); dir.startsWith(LANE_ROOT); dir = dirname(dir)) {
        const manifest = join(dir, "package.json");
        if (existsSync(manifest)) {
            return JSON.parse(readFileSync(manifest, "utf8")).type === "module" ? "esm" : "cjs";
        }
    }
    return "cjs";
}

/** Every specifier the parser finds in one file, as { text, syntax, line } or { pattern, syntax, line }. */
function specifiersOf(file) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
    const found = [];
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const record = (node, syntax) => {
        if (ts.isStringLiteralLike(node)) {
            found.push({ text: node.text, syntax, line: lineOf(node) });
        } else if (ts.isTemplateExpression(node)) {
            const parts = [node.head.text, ...node.templateSpans.flatMap((span) => ["\u0000", span.literal.text])];
            found.push({ pattern: parts, syntax, line: lineOf(node) });
        }
    };
    const isRequireCallee = (callee) =>
        (ts.isIdentifier(callee) && callee.text === "require")
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
            && callee.expression.text === "require" && callee.name.text === "resolve");

    const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            record(node.moduleSpecifier, "static");
        } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                record(node.arguments[0], "dynamic");
            } else if (isRequireCallee(node.expression)) {
                record(node.arguments[0], "require");
            }
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            record(node.argument.literal, "type");
        } else if (ts.isJSDocImportTag(node)) {
            record(node.moduleSpecifier, "type");
        }
        for (const doc of node.jsDoc ?? []) visit(doc);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

const esmResolve = (specifier) => import.meta.resolve(specifier);

/** Returns null when the specifier resolves, else the reason it does not. */
function unresolved(file, spec, format) {
    const esm = spec.syntax === "static" || spec.syntax === "dynamic" || (spec.syntax === "type" && format === "esm");

    if (spec.pattern) {
        const [head, ...rest] = spec.pattern;
        const slash = head.lastIndexOf("/");
        const dir = join(dirname(file), head.slice(0, slash + 1));
        const regex = new RegExp(`^${[head.slice(slash + 1), ...rest]
            .map((part) => (part === "\u0000" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
            .join("")}$`);
        const matches = existsSync(dir) ? readdirSync(dir).filter((name) => regex.test(name)) : [];
        return matches.length > 0 ? null : "template matches no file";
    }

    const text = spec.text;
    try {
        if (!esm) {
            createRequire(file).resolve(text);
            return null;
        }
        if (text.startsWith("./") || text.startsWith("../") || text.startsWith("/")) {
            const target = fileURLToPath(new URL(text, pathToFileURL(file)));
            return existsSync(target) && statSync(target).isFile() ? null : "no such file (ESM takes the path exactly as written)";
        }
        const url = esmResolve(text);
        if (url.startsWith("file:")) {
            const target = fileURLToPath(url);
            return existsSync(target) ? null : `resolves to missing ${relative(LANE_ROOT, target)}`;
        }
        return null;
    } catch (error) {
        return error.code ?? error.message;
    }
}

describe("module specifiers", () => {
    it("resolves every specifier written in the lane, docblock and type-only ones included", (t) => {
        const files = laneFiles();
        const counts = { static: 0, dynamic: 0, require: 0, type: 0 };
        const broken = [];

        for (const file of files) {
            const format = moduleFormat(file);
            for (const spec of specifiersOf(file)) {
                counts[spec.syntax] += 1;
                const reason = unresolved(file, spec, format);
                if (reason !== null) {
                    const shown = spec.text ?? spec.pattern.join("").replace(/\u0000/g, "${...}");
                    broken.push(`${relative(LANE_ROOT, file).split(sep).join("/")}:${spec.line} ${spec.syntax} "${shown}": ${reason}`);
                }
            }
        }

        t.diagnostic(`${files.length} file(s): ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
        assert.deepEqual(broken, []);
        // The walk must keep reaching every kind of specifier: a parser or walker
        // regression that silently finds none of one kind fails here.
        for (const [syntax, count] of Object.entries(counts)) {
            assert.ok(count > 0, `no ${syntax} specifier found in ${files.length} file(s)`);
        }
    });
});
