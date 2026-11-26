/**
 * Recounts every `document_symbol` task in bench/tasks.json under the rule the lane notes state
 * (issue #223, checklist C.3): N is the file's module-level declarations plus the members they
 * declare (constructor parameter properties included); function-local variables, parameters,
 * object-literal keys, anonymous callbacks and import or re-export bindings are not symbols.
 *
 * The box's three clauses are checked as written: `symbols` equals the recount as a multiset,
 * `min_symbols` equals floor(0.75 * N), and `must_include` lists only counted names and no more of
 * them than `min_symbols` allows.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const LANE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Task {
    id: string;
    surface: string;
    from: { file: string };
    expect: { symbols?: string[]; min_symbols?: number; must_include?: string[] };
}

function nameOf(node: { name?: ts.Node }): string | undefined {
    return node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
    return (ts.getCombinedModifierFlags(parameter) & ts.ModifierFlags.ParameterPropertyModifier) !== 0;
}

function members(node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration | ts.EnumDeclaration): string[] {
    const names: string[] = [];
    for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) {
            names.push("constructor");
            for (const parameter of member.parameters) {
                if (isParameterProperty(parameter) && ts.isIdentifier(parameter.name)) {
                    names.push(parameter.name.text);
                }
            }
            continue;
        }
        const name = nameOf(member);
        if (name !== undefined) {
            names.push(name);
        }
    }

    return names;
}

/** Names the notes count in one file: module-level declarations and their members. */
function countedSymbols(source: ts.SourceFile): string[] {
    const names: string[] = [];
    for (const statement of source.statements) {
        if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) {
            const name = nameOf(statement);
            if (name !== undefined) {
                names.push(name);
            }
            names.push(...members(statement));
        } else if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement)) {
            const name = nameOf(statement);
            if (name !== undefined) {
                names.push(name);
            }
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    names.push(declaration.name.text);
                }
            }
        }
        // Import declarations and export ... from re-exports declare no name inside the file.
    }

    return names;
}

const manifest = JSON.parse(readFileSync(join(LANE, "bench", "tasks.json"), "utf8")) as { tasks: Task[] };
const tasks = manifest.tasks.filter((task) => task.surface === "document_symbol");

describe("document_symbol keys follow the notes' symbol rule", () => {
    it("finds the lane's document_symbol tasks", () => {
        expect(tasks.length).toBeGreaterThan(0);
    });

    for (const task of tasks) {
        it(task.id, () => {
            const path = join(LANE, task.from.file);
            const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
            const counted = countedSymbols(source);
            const symbols = task.expect.symbols ?? [];
            const mustInclude = task.expect.must_include ?? [];

            expect([...symbols].sort()).toEqual([...counted].sort());
            expect(task.expect.min_symbols).toBe(Math.floor(0.75 * counted.length));
            for (const name of mustInclude) {
                expect(counted, `must_include ${name}`).toContain(name);
            }
            expect(mustInclude.length).toBeLessThanOrEqual(task.expect.min_symbols ?? -1);
        });
    }
});
