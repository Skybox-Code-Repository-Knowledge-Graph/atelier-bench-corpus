/**
 * Recounts every `references` task in bench/tasks.json under the counting rule the lane notes
 * state (issue #223, checklist B.4 and C.4), so a key whose count no longer follows from the tree
 * fails here instead of waiting for a grader.
 *
 * The rule, as the notes word it: a count of lines, over every .ts and .tsx file under packages/.
 * A line counts once when the asked name is written on it as an identifier (a call, a read, a
 * construction, a type position, a JSX tag, a decorator, or an import, import type or re-export
 * line that binds it). The from line, the name of any declaration (such as the other half of a
 * declaration merge), comments, docblocks, string literals and module specifiers never count.
 * On a name_only task the string literal is the name, and a line that only binds or re-exports a
 * constant holding it is an optional site.
 *
 * Comments and docblocks are not syntax nodes and a module specifier is a string, so walking the
 * parsed tree for identifiers applies the rule without a regular expression. The walk is syntax
 * only: it matches the asked name, not the symbol it binds to. A same-name identifier bound to
 * another declaration would land in the counted set, and the counted == keyed assertion below then
 * fails, so such a stray surfaces here instead of passing silently. No references target in the lane
 * is imported under an alias today.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const LANE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Site {
    file: string;
    needle: string;
    lines?: number;
}

interface Task {
    id: string;
    surface: string;
    from: Site & { symbol: string };
    expect: {
        kind?: string;
        exact_count?: number;
        known_sites?: Site[];
        repeated_sites?: Site[];
        optional_sites?: Site[];
    };
}

/**
 * Declaration names that share the asked name and are not counted, each with the reason a reader
 * can check. Every other declaration-name hit fails the test, so a new one has to be explained.
 */
const DECLARATIONS: Record<string, Record<string, string>> = {
    "refs-money-class": {
        "packages/core/src/money.ts:export namespace Money {": "the namespace half of the class + namespace merge",
    },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") {
            continue;
        }
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            sourceFiles(path, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(path);
        }
    }

    return out;
}

const files = sourceFiles(join(LANE, "packages")).map((path) => {
    const text = readFileSync(path, "utf8");
    const kind = extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

    return {
        rel: relative(LANE, path).split("\\").join("/"),
        lines: text.split(/\r?\n/),
        source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind),
    };
});

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** 1-based line numbers of `file` that contain `needle`. */
function linesWith(file: string, needle: string): number[] {
    const found = files.find((candidate) => candidate.rel === file);
    if (found === undefined) {
        throw new Error(`no such lane file: ${file}`);
    }

    return found.lines.flatMap((line, index) => (line.includes(needle) ? [index + 1] : []));
}

function oneLine(site: Site): string {
    const lines = linesWith(site.file, site.needle);
    expect(lines, `${site.file}: ${site.needle}`).toHaveLength(1);

    return `${site.file}:${lines[0]}`;
}
/**
 * Node kinds whose `name` declares something. Import and export specifiers are absent on purpose:
 * a line that binds the name counts. A shorthand property (`{ name }`) reads the name, so it is
 * absent too.
 */
const DECLARATION_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.EnumMember,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.MethodSignature,
    ts.SyntaxKind.PropertyDeclaration,
    ts.SyntaxKind.PropertySignature,
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.Parameter,
    ts.SyntaxKind.TypeParameter,
    ts.SyntaxKind.BindingElement,
]);

/** The node is the name of a declaration, which never counts as a reference. */
function isDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent as ts.Node & { name?: ts.Node };

    return DECLARATION_KINDS.has(parent.kind) && parent.name === node;
}

interface Hits {
    counted: Set<string>;
    declarations: Map<string, string>;
}

function identifierHits(name: string): Hits {
    const counted = new Set<string>();
    const declarations = new Map<string, string>();
    for (const file of files) {
        walk(file.source, (node) => {
            if (!ts.isIdentifier(node) || node.text !== name) {
                return;
            }
            const line = lineOf(file.source, node);
            const at = `${file.rel}:${line}`;
            if (isDeclarationName(node)) {
                declarations.set(at, `${file.rel}:${(file.lines[line - 1] ?? "").trim()}`);
            } else {
                counted.add(at);
            }
        });
    }

    return { counted, declarations };
}

function literalHits(literal: string): Set<string> {
    const counted = new Set<string>();
    for (const file of files) {
        walk(file.source, (node) => {
            if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === literal) {
                counted.add(`${file.rel}:${lineOf(file.source, node)}`);
            }
        });
    }

    return counted;
}

/** Names of constants whose initializer is the literal itself. */
function constantsHolding(literal: string): string[] {
    const names: string[] = [];
    for (const file of files) {
        walk(file.source, (node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && ts.isStringLiteral(node.initializer) && node.initializer.text === literal) {
                names.push(node.name.text);
            }
        });
    }

    return names;
}

const manifest = JSON.parse(readFileSync(join(LANE, "bench", "tasks.json"), "utf8")) as { tasks: Task[] };
const tasks = manifest.tasks.filter((task) => task.surface === "references");

describe("references counts follow the notes' counting rule", () => {
    it("finds the lane's references tasks", () => {
        expect(tasks.length).toBeGreaterThan(0);
    });

    for (const task of tasks) {
        it(task.id, () => {
            const from = oneLine(task.from);
            const keyed = new Set((task.expect.known_sites ?? []).map(oneLine));
            for (const group of task.expect.repeated_sites ?? []) {
                const lines = linesWith(group.file, group.needle);
                expect(lines, `${group.file}: ${group.needle}`).toHaveLength(group.lines ?? -1);
                for (const line of lines) {
                    keyed.add(`${group.file}:${line}`);
                }
            }
            const optional = new Set((task.expect.optional_sites ?? []).map(oneLine));

            let counted: Set<string>;
            if (task.expect.kind === "name_only") {
                const literal = task.from.symbol;
                counted = literalHits(literal);
                counted.delete(from);
                // Lines that only bind or re-export a constant holding the literal are the optional sites.
                const binding = new Set<string>();
                for (const constant of constantsHolding(literal)) {
                    for (const line of identifierHits(constant).counted) {
                        if (!counted.has(line)) {
                            binding.add(line);
                        }
                    }
                }
                expect([...binding].sort()).toEqual([...optional].sort());
            } else {
                const hits = identifierHits(task.from.symbol);
                counted = hits.counted;
                counted.delete(from);
                const explained = DECLARATIONS[task.id] ?? {};
                const unexplained = [...hits.declarations]
                    .filter(([at]) => at !== from)
                    .map(([, text]) => text)
                    .filter((text) => !(text in explained));
                expect(unexplained, "declaration-name hits the notes' rule does not explain").toEqual([]);
                for (const line of optional) {
                    expect(counted.has(line), `${line} is optional but counted`).toBe(false);
                }
            }

            expect([...counted].sort()).toEqual([...keyed].sort());
            expect(counted.size).toBe(task.expect.exact_count);
        });
    }
});
