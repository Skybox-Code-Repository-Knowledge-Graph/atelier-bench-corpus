/**
 * Every module specifier written anywhere in the lane resolves (issue #223, checklist F.1).
 *
 * `tsc` already fails on a broken value or type-only import, but it never reads a specifier inside
 * a comment, so a docblock link of the form {@link import(<path>).Name} can point at a file that
 * does not exist while typecheck and the tests stay green. This test reads every .ts, .tsx, .mts
 * and .mjs file in the lane outside node_modules (fixtures included) and collects:
 *   - static import and export specifiers, value and type-only, side-effect imports included;
 *   - import() calls and require() calls with a string argument;
 *   - type-level import(<path>) types;
 *   - the module named by a declare-module augmentation inside a module file;
 *   - import(<path>) written inside any comment or docblock;
 *   - triple-slash path and types references;
 * and resolves each with TypeScript's own module resolution under the lane's root tsconfig, or
 * against an ambient module declaration (@types/node's "node:*", the lane's .d.ts modules). It also
 * checks the specifier-shaped paths in JSON config: package.json `exports` targets and tsconfig
 * `extends` and `paths` targets. (This header writes <path> instead of a quoted path so that it
 * holds no specifier itself.)
 *
 * The same resolver then walks the module graph from every test file, and the last block fails
 * when a source file under packages/<name>/src is not reached (issue #223, checklist F.5).
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const LANE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Kind = "static" | "type-only" | "call" | "type-level" | "augmentation" | "comment" | "reference";

interface Specifier {
    kind: Kind;
    file: string;
    line: number;
    text: string;
}

function laneFiles(dir: string, pattern: RegExp, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) {
            continue;
        }
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            laneFiles(path, pattern, out);
        } else if (pattern.test(entry)) {
            out.push(path);
        }
    }

    return out;
}

const COMMENT_IMPORT = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

function collect(path: string): Specifier[] {
    const text = readFileSync(path, "utf8");
    const ext = extname(path);
    const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".mjs" || ext === ".js" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const file = relative(LANE, path).split("\\").join("/");
    const found: Specifier[] = [];
    const add = (specKind: Kind, node: ts.Node, spec: string) => {
        found.push({ kind: specKind, file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: spec });
    };
    const comments = new Map<number, string>();

    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
            const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
            add(typeOnly ? "type-only" : "static", node.moduleSpecifier, node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]!)) {
            const callee = node.expression;
            if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
                add("call", node, (node.arguments[0] as ts.StringLiteral).text);
            }
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            add("type-level", node.argument, node.argument.literal.text);
        } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && ts.isExternalModule(source)) {
            add("augmentation", node.name, node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);

    // Comments are trivia: each one leads or trails some token, and a comment that leads only a
    // closing brace or the end of the file belongs to no node forEachChild visits. So walk every
    // token (getChildren), skipping JSDoc nodes (their comment is the next token's leading trivia)
    // and tokens whose leading text is literal text, not trivia (JSX text, template continuations).
    const NOT_TRIVIA = new Set<ts.SyntaxKind>([ts.SyntaxKind.JsxText, ts.SyntaxKind.JsxTextAllWhiteSpaces, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail]);
    const tokens = (node: ts.Node): void => {
        const children = node.getChildren(source);
        if (children.length === 0) {
            const leading = NOT_TRIVIA.has(node.kind) ? [] : (ts.getLeadingCommentRanges(text, node.pos) ?? []);
            for (const range of [...leading, ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]) {
                comments.set(range.pos, text.slice(range.pos, range.end));
            }

            return;
        }
        for (const child of children) {
            if (child.kind < ts.SyntaxKind.FirstJSDocNode || child.kind > ts.SyntaxKind.LastJSDocNode) {
                tokens(child);
            }
        }
    };
    tokens(source);

    for (const [pos, comment] of comments) {
        for (const match of comment.matchAll(COMMENT_IMPORT)) {
            const offset = pos + (match.index ?? 0);
            found.push({ kind: "comment", file, line: source.getLineAndCharacterOfPosition(offset).line + 1, text: match[1]! });
        }
    }
    for (const reference of [...source.referencedFiles, ...source.typeReferenceDirectives]) {
        found.push({ kind: "reference", file, line: source.getLineAndCharacterOfPosition(reference.pos).line + 1, text: reference.fileName });
    }

    return found;
}

const config = ts.getParsedCommandLineOfConfigFile(join(LANE, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
});
if (config === undefined) {
    throw new Error("tsconfig.json did not parse");
}
const options = config.options;
const program = ts.createProgram({ rootNames: config.fileNames, options });
/** Ambient module name -> the file that declares it (@types/node, the lane's .d.ts modules). */
const ambientModules = new Map<string, string>();
for (const symbol of program.getTypeChecker().getAmbientModules()) {
    const declaredIn = symbol.declarations?.[0]?.getSourceFile().fileName;
    if (declaredIn !== undefined) {
        ambientModules.set(symbol.getName().replace(/^"|"$/g, ""), declaredIn);
    }
}

/** The file a specifier resolves to, or undefined when it resolves nowhere. */
function resolveTarget(specifier: Specifier): string | undefined {
    const from = join(LANE, specifier.file);
    if (specifier.kind === "reference") {
        const path = join(dirname(from), specifier.text);

        return existsSync(path) ? path : ts.resolveTypeReferenceDirective(specifier.text, from, options, ts.sys).resolvedTypeReferenceDirective?.resolvedFileName;
    }
    const ambient = ambientModules.get(specifier.text);
    if (ambient !== undefined) {
        return ambient;
    }
    const resolved = ts.resolveModuleName(specifier.text, from, options, ts.sys).resolvedModule?.resolvedFileName;

    return resolved === undefined ? undefined : realpathSync(resolved);
}

function resolves(specifier: Specifier): boolean {
    return resolveTarget(specifier) !== undefined;
}

const sources = laneFiles(LANE, /\.(ts|tsx|mts|mjs)$/);
const specifiers = sources.flatMap(collect);

describe("every module specifier in the lane resolves", () => {
    it("reads every source file and finds each kind of specifier the lane writes", () => {
        const count = (kind: Kind) => specifiers.filter((specifier) => specifier.kind === kind).length;

        expect(sources.length).toBeGreaterThan(200);
        expect(count("static")).toBeGreaterThan(0);
        expect(count("type-only")).toBeGreaterThan(0);
        expect(count("type-level")).toBeGreaterThan(0);
        expect(count("augmentation")).toBeGreaterThan(0);
        expect(count("comment")).toBeGreaterThan(0);
    });

    it("resolves each one, docblock specifiers included", () => {
        const broken = specifiers.filter((specifier) => !resolves(specifier)).map((specifier) => `${specifier.file}:${specifier.line} ${specifier.kind} "${specifier.text}"`);

        expect(broken, `unresolved: ${broken.join("; ")}`).toEqual([]);
    });

    it("points every package.json exports target at a real file or directory", () => {
        const broken: string[] = [];
        for (const manifest of laneFiles(join(LANE, "packages"), /^package\.json$/)) {
            const exportsMap = (JSON.parse(readFileSync(manifest, "utf8")) as { exports?: Record<string, string> }).exports ?? {};
            for (const [key, target] of Object.entries(exportsMap)) {
                const path = join(dirname(manifest), target.includes("*") ? dirname(target) : target);
                if (!existsSync(path)) {
                    broken.push(`${relative(LANE, manifest)} ${key} -> ${target}`);
                }
            }
        }

        expect(broken, `unresolved: ${broken.join("; ")}`).toEqual([]);
    });

    it("points every tsconfig extends and paths target at a real file or directory", () => {
        const broken: string[] = [];
        for (const tsconfig of laneFiles(LANE, /^tsconfig.*\.json$/)) {
            const { config: raw } = ts.readConfigFile(tsconfig, ts.sys.readFile) as { config: { extends?: string; compilerOptions?: { paths?: Record<string, string[]> } } };
            if (raw.extends !== undefined && !existsSync(join(dirname(tsconfig), raw.extends))) {
                broken.push(`${relative(LANE, tsconfig)} extends ${raw.extends}`);
            }
            for (const [alias, targets] of Object.entries(raw.compilerOptions?.paths ?? {})) {
                for (const target of targets) {
                    if (!existsSync(join(dirname(tsconfig), target.includes("*") ? dirname(target) : target))) {
                        broken.push(`${relative(LANE, tsconfig)} paths ${alias} -> ${target}`);
                    }
                }
            }
        }

        expect(broken, `unresolved: ${broken.join("; ")}`).toEqual([]);
    });
});

const TEST_FILE = /^packages\/[^/]+\/tests\/.+\.test\.tsx?$/;
const SOURCE_FILE = /^packages\/[^/]+\/src\/.+\.tsx?$/;
/** Specifier kinds that load or type-check their target; a docblock link does neither. */
const IMPORT_KINDS = new Set<Kind>(["static", "type-only", "call", "type-level", "augmentation", "reference"]);

function laneRelative(path: string): string {
    return relative(LANE, path).split("\\").join("/");
}

function identifiersIn(file: string): Set<string> {
    const path = join(LANE, file);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            names.add(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);

    return names;
}

/**
 * Every lane file the test files reach through imports of any kind (value, type-only, type-level,
 * import() calls, augmentations), resolved as above. An ambient module name reaches the .d.ts that
 * declares it; a global declaration file (no imports or exports) is reached by a file that names
 * one of its top-level declarations, such as the JSX namespace.
 */
function reachedFromTests(): Set<string> {
    const byFile = new Map<string, Specifier[]>();
    for (const specifier of specifiers) {
        byFile.set(specifier.file, [...(byFile.get(specifier.file) ?? []), specifier]);
    }
    const globals = new Map<string, string>();
    for (const path of sources.filter((candidate) => candidate.endsWith(".d.ts"))) {
        const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        if (ts.isExternalModule(source)) {
            continue;
        }
        for (const statement of source.statements) {
            const name = (statement as ts.Statement & { name?: ts.Node }).name;
            if (name !== undefined && ts.isIdentifier(name)) {
                globals.set(name.text, laneRelative(path));
            }
        }
    }

    const reached = new Set<string>();
    const queue = sources.map(laneRelative).filter((file) => TEST_FILE.test(file));
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (reached.has(file)) {
            continue;
        }
        reached.add(file);
        for (const specifier of byFile.get(file) ?? []) {
            const resolved = IMPORT_KINDS.has(specifier.kind) ? resolveTarget(specifier) : undefined;
            if (resolved !== undefined) {
                const next = laneRelative(resolved);
                if (!next.startsWith("..") && !next.includes("node_modules")) {
                    queue.push(next);
                }
            }
        }
        const names = identifiersIn(file);
        for (const [name, declaredIn] of globals) {
            if (names.has(name)) {
                queue.push(declaredIn);
            }
        }
    }

    return reached;
}

describe("every source file the lane adds is reached from a test (issue #223, checklist F.5)", () => {
    it("leaves no packages/*/src file outside the module graph of the test files", () => {
        const reached = reachedFromTests();
        const sourceFiles = sources.map(laneRelative).filter((file) => SOURCE_FILE.test(file));
        const unreached = sourceFiles.filter((file) => !reached.has(file));

        expect(sourceFiles.length).toBeGreaterThan(200);
        expect(unreached, `unreached: ${unreached.join("; ")}`).toEqual([]);
    });
});
