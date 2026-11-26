#!/usr/bin/env node
// Cross-lane task matrix + verifier conformance check.
//
//   node bench/check-matrix.mjs            # verify bench/matrix.json matches reality; exit 0/1
//   node bench/check-matrix.mjs --write    # regenerate bench/matrix.json from the lanes (the
//                                           # only way to add a canonical id)
//   node bench/check-matrix.mjs --write --matrix-only
//                                           # write the same bench/matrix.json after the static
//                                           # guards (step 0) alone: no lane verifier and no
//                                           # conformance run (steps 1 and 4), so nothing compiles
//
// Node built-ins only, run from the repository root. CI runs the default (read-only) mode.
// `--write` and `--write --matrix-only` are one function (runWrite): the matrix is built by the same
// buildMatrix() and written by the same serialize(), so for one tree both write the same bytes.
// `--matrix-only` exists for whoever may not compile (the rust verifier is `cargo run`); the
// default check stays the full run. `--matrix-only` without `--write` is an error.
//
// 0. Static guards, before any verifier runs: bench/conformance/src/crlf.txt still ends every line
//    in CRLF (the c-crlf case is no CRLF test otherwise) and .gitattributes still keeps it out of
//    line-ending normalisation; every task id, in each lane and in bench/conformance, is lower-case
//    kebab-case and unique there; every hover task states a `contains` string, byte-present in its
//    lane's source, and a hover id shared by several lanes uses one string in all of them; and a
//    list task that states a count lists exactly that many implementations; and bench/TOOL-SURFACE.md
//    (what checklist section E is graded against) names only task ids its lanes have, quotes only
//    lines its lanes' READMEs have, lists each lane's extractors as quoted, and pins the skybox
//    version score-tools.yml installs (issue #223).
// 1. For each lane in matrix.json's `lanes`, runs its verifier from the lane directory and
//    requires exit 0.
// 2. Cross-checks the ids each verifier reported against that lane's bench/tasks.json, then
//    builds {lane -> {id -> surface}} straight from tasks.json.
// 3. Asserts every task id is listed in matrix.canonical, every canonical entry's `lanes` array
//    matches reality, any id shared by two or more lanes carries the same `surface` in each, and
//    an id shared by two or more lanes on the cardinality / multi-parent surfaces states an
//    `exact_count` in every lane that carries it, and the same one.
// 4. Runs every lane verifier against bench/conformance/ (via --root) and diffs stdout against
//    bench/conformance/expected.txt byte for byte.
// 5. Prints a coverage grid and `matrix: OK (<n> canonical ids, <m> lanes)`, or the first
//    violation, and exits accordingly.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_PATH = join(REPO_ROOT, "bench", "matrix.json");
const CONFORMANCE_DIR = join(REPO_ROOT, "bench", "conformance");
const EXPECTED_PATH = join(CONFORMANCE_DIR, "expected.txt");
const CRLF_FIXTURE_PATH = join(CONFORMANCE_DIR, "src", "crlf.txt");
const CONFORMANCE_MANIFEST_PATH = join(CONFORMANCE_DIR, "bench", "tasks.json");
const GITATTRIBUTES_PATH = join(REPO_ROOT, ".gitattributes");
// Task ids are lower-case words of a-z and 0-9 joined by single hyphens (duplicateIdProblem).
const TASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The surfaces whose answer is an `implementations` list (listCountProblem).
const LIST_SURFACES = new Set(["implementation", "cardinality", "multi-parent"]);
const TOOL_SURFACE_PATH = join(REPO_ROOT, "bench", "TOOL-SURFACE.md");
const SCORE_TOOLS_PATH = join(REPO_ROOT, ".github", "workflows", "score-tools.yml");
// The language each lane is written in, as bench/TOOL-SURFACE.md's quoted list names it.
const LANE_LANGUAGES = { php: "PHP", rust: "Rust", typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go" };
const EXTRACTOR_CLASSES = new Set(["route parser", "ORM, schema or serialization", "other"]);

// Known lane verify commands. A lane is included only when its directory carries
// bench/tasks.json on disk -- a lane that does not exist yet is simply omitted (issue #5).
const LANE_DEFS = [
    { name: "php", verify: ["php", "bench/verify_tasks.php"] },
    { name: "rust", verify: ["cargo", "run", "-q", "-p", "bench-verify"] },
    { name: "typescript", verify: ["node", "bench/verify-tasks/verify.mjs"] },
    { name: "javascript", verify: ["node", "bench/verify-tasks/verify.mjs"] },
    { name: "python", verify: ["python3", "bench/verify_tasks.py"] },
    { name: "go", verify: ["go", "run", "./bench/verify"] },
];

const args = process.argv.slice(2);
const write = args.includes("--write");
const matrixOnly = args.includes("--matrix-only");

process.exit(matrixOnly && !write
    ? fail("--matrix-only needs --write (the default check always runs every lane verifier)")
    : write ? runWrite({ matrixOnly }) : runCheck());

/**
 * `--write`, and `--write --matrix-only`. matrixOnly skips the lane verifiers (step 1) and the
 * conformance run (step 4) and nothing else: the static guards, buildMatrix(), serialize(), the
 * grid and the OK line are the plain `--write` path's own.
 */
function runWrite({ matrixOnly }) {
    const lanes = presentLanes();

    const problem = staticProblem(lanes);
    if (problem !== undefined) {
        return fail(problem);
    }

    if (!matrixOnly) {
        for (const lane of lanes) {
            const result = runVerifier(lane);
            if (!verifierPassed(result)) {
                return fail(`${lane.name} verifier exited ${exitDescription(result)}`);
            }
        }
    }

    const built = buildMatrix(lanes);
    if (built.conflicts.length > 0) {
        return fail(built.conflicts[0]);
    }

    writeFileSync(MATRIX_PATH, serialize(built.matrix));

    if (!matrixOnly) {
        const conformanceCode = runConformance(lanes);
        if (conformanceCode !== 0) {
            return conformanceCode;
        }
    }

    printGrid(built.matrix);
    report(built.matrix);
    if (matrixOnly) {
        console.error("matrix: --matrix-only: no lane verifier and no conformance run; the default check is the full run");
    }
    return 0;
}

function runCheck() {
    if (!existsSync(MATRIX_PATH)) {
        return fail("bench/matrix.json missing (run --write)");
    }

    const committed = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
    const lanes = Object.keys(committed.lanes).map((name) => {
        const known = LANE_DEFS.find((lane) => lane.name === name);
        return known ?? { name, verify: committed.lanes[name].verify };
    });

    const problem = staticProblem(lanes);
    if (problem !== undefined) {
        return fail(problem);
    }

    for (const lane of lanes) {
        const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
        if (!existsSync(manifestPath)) {
            return fail(`lane ${lane.name} is in matrix.json but ${lane.name}/bench/tasks.json is missing`);
        }

        const result = runVerifier(lane);
        if (!verifierPassed(result)) {
            return fail(`${lane.name} verifier exited ${exitDescription(result)}`);
        }

        const reportedIds = parseReportedIds(result.stdout ?? "");
        const taskIds = new Set(readLaneTasks(lane).keys());
        for (const id of reportedIds) {
            if (!taskIds.has(id)) {
                return fail(`${lane.name} verifier reported ${id}, which is not in ${lane.name}/bench/tasks.json`);
            }
        }
        for (const id of taskIds) {
            if (!reportedIds.has(id)) {
                return fail(`${lane.name}/bench/tasks.json has ${id}, but the verifier never reported it`);
            }
        }
    }

    const built = buildMatrix(lanes);
    if (built.conflicts.length > 0) {
        return fail(built.conflicts[0]);
    }

    for (const [id, entry] of Object.entries(built.matrix.canonical)) {
        const committedEntry = committed.canonical[id];
        if (!committedEntry) {
            return fail(`${id} is present in lane(s) ${entry.lanes.join(", ")} but missing from matrix.canonical`);
        }
        if (committedEntry.surface !== entry.surface) {
            return fail(`${id} surface mismatch: matrix.json says "${committedEntry.surface}", tasks.json says "${entry.surface}"`);
        }
        const committedLanes = [...committedEntry.lanes].sort().join(",");
        const actualLanes = [...entry.lanes].sort().join(",");
        if (committedLanes !== actualLanes) {
            return fail(`${id} lanes mismatch: matrix.json says [${committedLanes}], reality is [${actualLanes}]`);
        }
    }
    for (const id of Object.keys(committed.canonical)) {
        if (!built.matrix.canonical[id]) {
            return fail(`${id} is in matrix.canonical but no lane's tasks.json has it`);
        }
    }

    const conformanceCode = runConformance(lanes);
    if (conformanceCode !== 0) {
        return conformanceCode;
    }

    printGrid(built.matrix);
    report(built.matrix);
    return 0;
}

/** The first static guard that fails, or undefined. Reads files only; spawns nothing. */
function staticProblem(lanes) {
    return crlfFixtureProblem()
        ?? crlfAttributesProblem()
        ?? duplicateIdProblem(lanes)
        ?? hoverContainsProblem(lanes)
        ?? listCountProblem(lanes)
        ?? toolSurfaceProblem(lanes);
}

/**
 * bench/TOOL-SURFACE.md cannot rot (issue #223, checklist section E):
 *   - its `Pinned version:` is the skybox version .github/workflows/score-tools.yml installs;
 *   - each lane's coverage table ("### <lane>" under "## Per-lane coverage") has one row per
 *     extractor of the lane's language in the quoted list, in that order;
 *   - each row fills exactly one of Scored by (backticked ids, each in the lane's tasks.json),
 *     Deliberate gap (a double-quoted line of the lane README; never for a route parser, ruling R3)
 *     and Not yet (`not yet`);
 *   - each lane section has one `Language server (E.5): ` line, `not pinned yet` or ending in
 *     `; source "<README text>"` that the lane README pins it with.
 * NOT proven: that a listed task really exercises the extractor (a reviewer's read of its `from`
 * line), or that the quoted list is what the package prints (re-run the command in the file).
 */
function toolSurfaceProblem(lanes) {
    const where = relative(TOOL_SURFACE_PATH);
    if (!existsSync(TOOL_SURFACE_PATH)) {
        return `${where} is missing: checklist section E is graded against it`;
    }
    const text = readFileSync(TOOL_SURFACE_PATH, "utf8");

    const pinned = /^Pinned version: `(\d+\.\d+\.\d+)`$/m.exec(text)?.[1];
    const installed = existsSync(SCORE_TOOLS_PATH)
        ? /inputs\.skybox_version \|\| '(\d+\.\d+\.\d+)'/.exec(readFileSync(SCORE_TOOLS_PATH, "utf8"))?.[1]
        : undefined;
    if (pinned === undefined || pinned !== installed) {
        return `${where}: pinned version ${pinned ?? "(no \"Pinned version:\" line)"} is not the one ${relative(SCORE_TOOLS_PATH)} installs (${installed ?? "none found"}); re-run the npm view command at that version and update the file`;
    }

    const tables = markdownTables(text);
    const extractorsOf = new Map((tables.get("Framework extractors (ruling R2)")?.rows ?? [])
        .map(([language, list = ""]) => [language, list.split(", ")]));
    const serverPrefix = "Language server (E.5): ";

    for (const lane of lanes) {
        const language = LANE_LANGUAGES[lane.name];
        const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
        if (language === undefined || !existsSync(manifestPath)) {
            continue;
        }
        const expected = extractorsOf.get(language);
        if (expected === undefined) {
            return `${where}: the quoted extractor list has no ${language} row`;
        }
        const rows = tables.get(`Per-lane coverage > ${lane.name}`)?.rows ?? [];
        if (rows.length === 0) {
            return `${where}: no coverage table for lane ${lane.name} (a "### ${lane.name}" section under "## Per-lane coverage")`;
        }
        const listed = rows.map(([extractor]) => extractor);
        if (listed.join("\n") !== expected.join("\n")) {
            return `${where}: ${lane.name} rows are [${listed.join(", ")}], but the quoted ${language} list is [${expected.join(", ")}]; one row per extractor, in that order`;
        }

        const ids = new Set(readLaneTasks(lane).keys());
        const readme = existsSync(join(REPO_ROOT, lane.name, "README.md")) ? readFileSync(join(REPO_ROOT, lane.name, "README.md"), "utf8") : "";
        const quotes = (cell) => {
            const quote = /^"(.+)"$/.exec(cell)?.[1];
            return quote !== undefined && readme.includes(quote);
        };
        for (const [extractor, klass, scoredBy = "", gap = "", notYet = ""] of rows) {
            const at = `${where}: ${lane.name} ${extractor}`;
            if (!EXTRACTOR_CLASSES.has(klass)) {
                return `${at}: class ${JSON.stringify(klass)} is not one of: ${[...EXTRACTOR_CLASSES].join("; ")}`;
            }
            const filled = [scoredBy, gap, notYet].filter((cell) => cell !== "").length;
            if (filled !== 1) {
                return `${at}: fill exactly one of Scored by, Deliberate gap and Not yet (${filled} filled)`;
            }
            if (scoredBy !== "") {
                if (!/^`[^`]+`(?:, `[^`]+`)*$/.test(scoredBy)) {
                    return `${at}: Scored by must be backticked task ids separated by ", "`;
                }
                const missing = scoredBy.slice(1, -1).split("`, `").find((id) => !ids.has(id));
                if (missing !== undefined) {
                    return `${at}: task ${missing} is not in ${lane.name}/bench/tasks.json; update this row whenever a task id it names is renamed or retired`;
                }
            }
            if (gap !== "" && klass === "route parser") {
                return `${at}: a route parser cannot be a deliberate gap (ruling R3 reads E.1 literally); add a route task for it`;
            }
            if (gap !== "" && !quotes(gap)) {
                return `${at}: Deliberate gap must quote, in double quotes, a line of ${lane.name}/README.md that names the gap`;
            }
            if (notYet !== "" && notYet !== "not yet") {
                return `${at}: the Not yet cell reads ${JSON.stringify(notYet)}; write "not yet" or fill another cell`;
            }
        }

        const servers = (tables.get(`Per-lane coverage > ${lane.name}`)?.lines ?? []).filter((line) => line.startsWith(serverPrefix));
        if (servers.length !== 1) {
            return `${where}: the ${lane.name} section needs exactly one "${serverPrefix}..." line (${servers.length} found)`;
        }
        const server = servers[0].slice(serverPrefix.length);
        const source = /; source "(.+)"$/.exec(server)?.[1];
        if (server !== "not pinned yet" && !(source !== undefined && readme.includes(source))) {
            return `${where}: ${lane.name} language server: end the line with ; source "<the ${lane.name}/README.md text that pins it>", or write "not pinned yet"`;
        }
    }
    return undefined;
}

/**
 * A Markdown file's sections, keyed by the headings above them ("h2" or "h2 > h3"): each section's
 * first table (`header`, `rows`) and its other non-empty lines (`lines`). Fenced blocks are skipped.
 */
function markdownTables(text) {
    const sections = new Map();
    let key = "";
    let h2 = "";
    let fenced = false;
    const section = () => {
        if (!sections.has(key)) {
            sections.set(key, { header: null, rows: [], lines: [] });
        }
        return sections.get(key);
    };
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("```")) {
            fenced = !fenced;
        } else if (fenced) {
            continue;
        } else if (line.startsWith("## ")) {
            h2 = line.slice(3).trim();
            key = h2;
        } else if (line.startsWith("### ")) {
            key = `${h2} > ${line.slice(4).trim()}`;
        } else if (line.startsWith("|")) {
            const cells = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/)
                .map((cell) => cell.trim().replaceAll("\\|", "|"));
            if (section().header === null) {
                section().header = cells;
            } else if (!cells.every((cell) => /^-+$/.test(cell))) {
                section().rows.push(cells);
            }
        } else if (line.trim() !== "") {
            section().lines.push(line.trim());
        }
    }
    return sections;
}

/**
 * A list task that states a count lists exactly that many entries (issue #223; the cross-lane
 * exact_count guard proves only presence and agreement). On the implementation, cardinality and
 * multi-parent surfaces, a task with an `implementations` array and a count (`exact_count`, or
 * `extends_count` plus `implements_count`, which must agree when both are stated: the scorer's
 * listCount in bench/score/lib/plan.mjs) has exactly count entries. A task with no count is not
 * checked. NOT proven: that each entry resolves to a distinct line, or that the count is true of
 * the tree (bench/score/test/sites.test.mjs resolves the entries; the tree is a reviewer's read).
 */
function listCountProblem(lanes) {
    for (const lane of lanes) {
        const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
        if (!existsSync(manifestPath)) {
            continue;
        }
        for (const task of JSON.parse(readFileSync(manifestPath, "utf8")).tasks) {
            const expect = task.expect ?? {};
            if (!LIST_SURFACES.has(task.surface) || !Array.isArray(expect.implementations)) {
                continue;
            }
            const exact = Number.isInteger(expect.exact_count) ? expect.exact_count : null;
            const split = Number.isInteger(expect.extends_count) && Number.isInteger(expect.implements_count)
                ? expect.extends_count + expect.implements_count
                : null;
            if (exact !== null && split !== null && exact !== split) {
                return `${lane.name}:${task.id}: exact_count ${exact} disagrees with extends_count + implements_count ${split}; recount and make them agree`;
            }
            const count = exact ?? split;
            if (count !== null && count !== expect.implementations.length) {
                return `${lane.name}:${task.id}: the key states a count of ${count} but lists ${expect.implementations.length} implementations; recount from the tree and make the count and the list agree`;
            }
        }
    }
    return undefined;
}

/**
 * Hover `contains` strings are a cross-lane string contract (issue #223, C.6 and F.3):
 *   (0) every hover task states a non-empty `contains` string, lane-local ones too;
 *   (a) every hover task's `contains` is byte-present in its lane: in from.file, or else in another
 *       file git tracks under <lane>/ outside <lane>/bench/, Markdown excluded. The fallback exists
 *       because a hover asked at a call site shows the doc comment of a declaration in another file,
 *       and the key does not name that file;
 *   (b) a hover id carried by two or more lanes states a `contains` string in every lane that
 *       carries it, and the same one (an absent string never passes as agreement).
 * NOT proven: that the string sits in the doc comment of the hovered symbol, or anywhere a hover
 * would show it. (a) proves only that the lane's source quotes the string somewhere; reading the
 * declaration is still the reviewer's job.
 */
function hoverContainsProblem(lanes) {
    const stringsById = new Map();
    for (const lane of lanes) {
        const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
        if (!existsSync(manifestPath)) {
            continue;
        }
        let sources;
        for (const task of JSON.parse(readFileSync(manifestPath, "utf8")).tasks) {
            if (task.surface !== "hover") {
                continue;
            }
            const contains = typeof task.expect?.contains === "string" && task.expect.contains !== "" ? task.expect.contains : undefined;
            if (contains === undefined) {
                // A hover key with no string checks nothing (no scorer rule takes it either).
                return `${lane.name}:${task.id}: hover task states no contains string; quote the expected hover text from the source as expect.contains`;
            }
            if (!stringsById.has(task.id)) {
                stringsById.set(task.id, []);
            }
            stringsById.get(task.id).push([lane.name, contains]);

            const fromFile = typeof task.from?.file === "string" ? join(REPO_ROOT, lane.name, task.from.file) : undefined;
            if (fromFile !== undefined && existsSync(fromFile) && readFileSync(fromFile, "utf8").includes(contains)) {
                continue;
            }
            sources ??= laneSources(lane.name);
            if (sources.error !== undefined) {
                return sources.error;
            }
            if (!sources.paths.some((path) => readFileSync(path, "utf8").includes(contains))) {
                return `${lane.name}:${task.id}: hover contains ${JSON.stringify(contains)} is not byte-present in ${task.from?.file} or in any other tracked ${lane.name}/ source outside ${lane.name}/bench/`;
            }
        }
    }
    for (const [id, stated] of [...stringsById].sort(([a], [b]) => a.localeCompare(b))) {
        if (stated.length < 2) {
            continue;
        }
        // (0) above already refused a hover task without a string, so every lane here states one.
        if (new Set(stated.map(([, contains]) => contains)).size > 1) {
            const detail = stated.map(([name, contains]) => `${name}=${JSON.stringify(contains)}`).join(", ");
            return `${id}: shared hover id uses more than one contains string (${detail})`;
        }
    }
    return undefined;
}

/** Walk <dir> on disk, skipping dependency/build directories. Paths are repo-relative with "/". */
function walkLane(dir, prefix) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["vendor", "node_modules", "target", "__pycache__", ".git"].includes(entry.name)) {
            continue;
        }
        if (entry.isDirectory()) {
            out.push(...walkLane(join(dir, entry.name), `${prefix}${entry.name}/`));
        } else if (entry.isFile()) {
            out.push(`${prefix}${entry.name}`);
        }
    }
    return out;
}

/**
 * Absolute paths of the lane's source files, minus <lane>/bench/ and Markdown. Uses `git ls-files`
 * inside a work tree; outside one (git archive, tarball) it walks <lane>/ on disk instead.
 */
function laneSources(lane) {
    const result = spawnSync("git", ["ls-files", "-z", "--", `${lane}/`], { cwd: REPO_ROOT, encoding: "utf8" });
    let listed;
    if (!result.error && result.status === 0) {
        listed = result.stdout.split("\0");
    } else if (existsSync(join(REPO_ROOT, lane))) {
        listed = walkLane(join(REPO_ROOT, lane), `${lane}/`);
    } else {
        return { error: `${lane}/ not found: hover contains strings cannot be checked` };
    }
    const paths = listed
        .filter((path) => path !== "" && !path.startsWith(`${lane}/bench/`) && !path.endsWith(".md"))
        .map((path) => join(REPO_ROOT, path))
        .filter((path) => existsSync(path));
    return { paths };
}

/**
 * A task id repeated inside one tasks.json, a lane's or bench/conformance's. Every later step keys
 * tasks by id (Maps and Sets), so a repeat would collapse silently and both copies would pass; it
 * must fail by name instead. Ids must also be lower-case kebab-case (TASK_ID), so a case or
 * whitespace variant can never pass as a different id. A lane without tasks.json is skipped here
 * and reported by the verifier loop.
 */
function duplicateIdProblem(lanes) {
    const manifests = [
        ...lanes.map((lane) => join(REPO_ROOT, lane.name, "bench", "tasks.json")),
        CONFORMANCE_MANIFEST_PATH,
    ];
    for (const manifestPath of manifests) {
        if (!existsSync(manifestPath)) {
            continue;
        }
        const seen = new Set();
        for (const task of JSON.parse(readFileSync(manifestPath, "utf8")).tasks) {
            if (typeof task.id !== "string" || !TASK_ID.test(task.id)) {
                return `${relative(manifestPath)}: task id ${JSON.stringify(task.id)} is not lower-case kebab-case (words of a-z and 0-9 joined by single hyphens); rename it`;
            }
            if (seen.has(task.id)) {
                return `${relative(manifestPath)} repeats task id ${task.id}`;
            }
            seen.add(task.id);
        }
    }
    return undefined;
}

/**
 * .gitattributes keeps bench/conformance/src/crlf.txt out of line-ending normalisation (issue
 * #223; crlfFixtureProblem checks only the bytes checked out now): the last line whose pattern
 * matches the file and sets the `text` attribute must unset it (`-text`, or the `binary` macro).
 * Patterns are matched as git does for the forms used here: `*` and `?` within one path segment,
 * `**` across segments, a pattern without a slash against the file name. Other macros are not
 * expanded, and character classes are not parsed.
 */
function crlfAttributesProblem() {
    const target = relative(CRLF_FIXTURE_PATH);
    const fix = `keep "${target} -text" in .gitattributes, after every line that sets text for it`;
    if (!existsSync(GITATTRIBUTES_PATH)) {
        return `.gitattributes is missing; ${fix}`;
    }
    let last;
    for (const raw of readFileSync(GITATTRIBUTES_PATH, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const [pattern, ...attributes] = line.split(/\s+/);
        if (!gitPatternMatches(pattern, target)) {
            continue;
        }
        for (const attribute of attributes) {
            if (attribute === "-text" || attribute === "binary") {
                last = { line, unset: true };
            } else if (attribute === "text" || attribute.startsWith("text=") || attribute === "!text") {
                last = { line, unset: false };
            }
        }
    }
    if (last === undefined || !last.unset) {
        const found = last === undefined ? "no line unsets text for it" : `the last line setting text for it is "${last.line}"`;
        return `.gitattributes lets git normalise the line endings of ${target} (${found}); ${fix}`;
    }
    return undefined;
}

function gitPatternMatches(pattern, path) {
    // A slash at the start or in the middle anchors the pattern to the repository root.
    const anchored = pattern.includes("/");
    const glob = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    const subject = anchored ? path : path.slice(path.lastIndexOf("/") + 1);
    const segment = (part) => part.split("*")
        .map((piece) => piece.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("?", "[^/]"))
        .join("[^/]*");
    return new RegExp(`^${glob.split("**").map(segment).join(".*")}$`).test(subject);
}

/**
 * bench/conformance/src/crlf.txt exists for the c-crlf case ("CRLF line endings resolve like LF"), so
 * its bytes are the point: every line must end in CRLF. `.gitattributes` marks it `-text` so git
 * never normalizes it; this catches a recommit that loses the CR bytes anyway (it was committed
 * LF-only from 9d9e6d4 until issue #223).
 */
function crlfFixtureProblem() {
    if (!existsSync(CRLF_FIXTURE_PATH)) {
        return `missing ${relative(CRLF_FIXTURE_PATH)}`;
    }
    const text = readFileSync(CRLF_FIXTURE_PATH, "latin1");
    const crlf = text.split("\r\n").length - 1;
    const bareLf = text.replaceAll("\r\n", "").split("\n").length - 1;
    const bareCr = text.replaceAll("\r\n", "").split("\r").length - 1;
    if (crlf === 0 || bareLf > 0 || bareCr > 0 || !text.endsWith("\r\n")) {
        return `${relative(CRLF_FIXTURE_PATH)} must end every line in CRLF (found ${crlf} CRLF, ${bareLf} bare LF, ${bareCr} bare CR); keep it -text in .gitattributes and recommit the CR bytes`;
    }
    return undefined;
}

/** Lanes whose directory carries bench/tasks.json, in LANE_DEFS order. */
function presentLanes() {
    return LANE_DEFS.filter((lane) => existsSync(join(REPO_ROOT, lane.name, "bench", "tasks.json")));
}

/** Run one lane's verifier from its lane directory, optionally against an alternate --root. */
function runVerifier(lane, extraArgs = []) {
    const cwd = join(REPO_ROOT, lane.name);
    const [cmd, ...cmdArgs] = lane.verify;
    // `cargo run` needs a `--` separator before args meant for the binary itself,
    // or it rejects them as unknown cargo flags. php/node take extra args directly.
    const args = extraArgs.length > 0 && cmd === "cargo"
        ? [...cmdArgs, "--", ...extraArgs]
        : [...cmdArgs, ...extraArgs];
    return spawnSync(cmd, args, { cwd, encoding: "utf8" });
}

function verifierPassed(result) {
    return !result.error && result.status === 0;
}

function exitDescription(result) {
    return result.error ? `with error: ${result.error.message}` : String(result.status);
}

/** `<id>: OK` / `<id>: FAIL ...` lines -> the set of ids the verifier reported on. */
function parseReportedIds(stdout) {
    const ids = new Set();
    for (const line of stdout.split("\n")) {
        const match = /^([^\s:]+): (OK|FAIL)\b/.exec(line);
        if (match) {
            ids.add(match[1]);
        }
    }
    return ids;
}

/** One lane's bench/tasks.json -> Map<id, surface>. */
function readLaneTasks(lane) {
    const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
    const data = JSON.parse(readFileSync(manifestPath, "utf8"));
    const tasks = new Map();
    for (const task of data.tasks) {
        tasks.set(task.id, task.surface);
    }
    return tasks;
}

/** Same as readLaneTasks, but id -> expect.exact_count for the tasks that carry one. */
function readLaneExactCounts(lane) {
    const manifestPath = join(REPO_ROOT, lane.name, "bench", "tasks.json");
    const data = JSON.parse(readFileSync(manifestPath, "utf8"));
    const counts = new Map();
    for (const task of data.tasks) {
        const count = task.expect?.exact_count;
        if (Number.isInteger(count)) {
            counts.set(task.id, count);
        }
    }
    return counts;
}

/**
 * Shared ids on the cardinality and multi-parent surfaces count a DOMAIN invariant
 * (48 rules, 24 reports, 3 parents), so every lane that carries such an id must state an
 * exact_count, and the same number (issue #223: an absent count used to pass as agreement).
 * Other surfaces (glob imports, overload sets) count lane-specific facts and are not compared.
 * An id carried by one lane only is not shared and is not checked. Returns a conflict message
 * or undefined.
 */
function exactCountConflict(id, surface, inLanes, laneCounts) {
    if ((surface !== "cardinality" && surface !== "multi-parent") || inLanes.length < 2) {
        return undefined;
    }
    const missing = inLanes.filter((name) => !laneCounts.get(name).has(id));
    if (missing.length > 0) {
        return `${id}: shared ${surface} id states no exact_count in ${missing.join(", ")} (every lane carrying it must state the same one)`;
    }
    const stated = inLanes.map((name) => [name, laneCounts.get(name).get(id)]);
    const distinct = new Set(stated.map(([, count]) => count));
    if (distinct.size <= 1) {
        return undefined;
    }
    const detail = stated.map(([name, count]) => `${name}=${count}`).join(", ");
    return `${id}: exact_count differs across lanes (${detail})`;
}

/**
 * Build {version, lanes, canonical} purely from each lane's tasks.json (no verifier
 * execution). Deterministic and side-effect free, so both --write and the read-only
 * check can compare against the exact same computation.
 */
function buildMatrix(lanes) {
    const laneTasks = new Map(lanes.map((lane) => [lane.name, readLaneTasks(lane)]));

    const ids = new Set();
    for (const tasks of laneTasks.values()) {
        for (const id of tasks.keys()) {
            ids.add(id);
        }
    }

    const canonical = {};
    const conflicts = [];
    const laneCounts = new Map(lanes.map((lane) => [lane.name, readLaneExactCounts(lane)]));
    for (const id of [...ids].sort()) {
        const inLanes = lanes.filter((lane) => laneTasks.get(lane.name).has(id)).map((lane) => lane.name);
        const surfaces = new Set(inLanes.map((name) => laneTasks.get(name).get(id)));
        if (surfaces.size > 1) {
            conflicts.push(`${id}: surface differs across lanes (${[...surfaces].join(", ")})`);
            continue;
        }
        const surface = [...surfaces][0];
        const countConflict = exactCountConflict(id, surface, inLanes, laneCounts);
        if (countConflict !== undefined) {
            conflicts.push(countConflict);
            continue;
        }
        canonical[id] = { surface, lanes: inLanes };
    }

    const matrixLanes = {};
    for (const lane of lanes) {
        matrixLanes[lane.name] = { verify: lane.verify };
    }

    return { matrix: { version: 1, lanes: matrixLanes, canonical }, conflicts };
}

function serialize(matrix) {
    return `${JSON.stringify(matrix, null, 2)}\n`;
}

/** Runs every lane verifier against bench/conformance/ and diffs stdout byte for byte. */
function runConformance(lanes) {
    if (!existsSync(EXPECTED_PATH)) {
        return fail(`missing ${relative(EXPECTED_PATH)}`);
    }
    const expected = readFileSync(EXPECTED_PATH, "utf8");

    for (const lane of lanes) {
        const result = runVerifier(lane, ["--root", CONFORMANCE_DIR]);
        const actual = result.stdout ?? "";
        if (actual !== expected) {
            return fail(`conformance drift in ${lane.name}: stdout does not match ${relative(EXPECTED_PATH)} byte for byte`);
        }
    }

    return 0;
}

function relative(path) {
    return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

/** Coverage grid: rows = canonical ids, columns = lanes, checkmark or middle dot per cell. */
function printGrid(matrix) {
    const laneNames = Object.keys(matrix.lanes);
    const ids = Object.keys(matrix.canonical).sort();
    const idWidth = Math.max("canonical id".length, ...ids.map((id) => id.length));

    console.log(`${"canonical id".padEnd(idWidth)}  ${laneNames.join(" ")}`);
    for (const id of ids) {
        const laneSet = new Set(matrix.canonical[id].lanes);
        const row = laneNames.map((name) => (laneSet.has(name) ? "✓" : "·").padEnd(name.length)).join(" ");
        console.log(`${id.padEnd(idWidth)}  ${row}`);
    }
}

function report(matrix) {
    const idCount = Object.keys(matrix.canonical).length;
    const laneCount = Object.keys(matrix.lanes).length;
    console.log(`matrix: OK (${idCount} canonical ids, ${laneCount} lanes)`);
}

function fail(message) {
    console.error(`matrix: FAIL ${message}`);
    return 1;
}
