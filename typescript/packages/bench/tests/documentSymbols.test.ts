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

/**
 * The names a declaration introduces: an identifier, a string-literal name, a #private name, or
 * every identifier bound by a destructuring pattern. Anything else (a computed name, no name where
 * the rule counts one) throws, so a construct this walker cannot read can never leave the key and
 * the test agreeing by accident.
 */
function namesOf(name: ts.Node | undefined, what: string): string[] {
    if (name === undefined) {
        return []; // an anonymous default export declares no name
    }
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) || ts.isNumericLiteral(name)) {
        return [name.text];
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : namesOf(element.name, what)));
    }

    throw new Error(`cannot read the name of ${what}: ${name.getText()} (kind ${ts.SyntaxKind[name.kind]})`);
}

function nameOf(node: { name?: ts.Node }): string[] {
    return namesOf(node.name, "member");
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
        if (member.name === undefined) {
            if (ts.isSemicolonClassElement(member)) {
                continue;
            }
            throw new Error(`cannot read the name of an unnamed member (kind ${ts.SyntaxKind[member.kind]}): the notes' rule does not count it`);
        }
        names.push(...nameOf(member));
    }

    return names;
}

/** Names the notes count in one file: module-level declarations and their members. */
function countedSymbols(source: ts.SourceFile): string[] {
    const names: string[] = [];
    const declare = (node: { name?: ts.Node }, what: string): void => {
        names.push(...namesOf(node.name, what));
    };
    for (const statement of source.statements) {
        if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) {
            declare(statement, statement.getText(source).slice(0, 40));
            names.push(...members(statement));
        } else if (ts.isModuleDeclaration(statement)) {
            declare(statement, "namespace");
            // The notes count a namespace as one symbol and do not count what is declared inside it.
            if (statement.body !== undefined && ts.isModuleBlock(statement.body) && statement.body.statements.length > 0) {
                throw new Error(`namespace ${statement.name.getText(source)} declares members: the notes count a namespace as one symbol and do not count what is inside it`);
            }
        } else if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
            declare(statement, "declaration");
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                declare(declaration, "variable");
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
