# Scorer

Compares one tool's answers for one lane with that lane's `bench/tasks.json`.

The scorer knows nothing about any tool. An **adapter** asks a tool the corpus's questions and
writes its replies in the answer format below; the scorer reads that file and the answer key and
reports a verdict per task. Tool names live in adapters and answer files, never in a `tasks.json`.

```
node bench/score/score.mjs --lane go --answers go.answers.json
node bench/score/score.mjs --lane go --answers go.answers.json --format json
node bench/score/oracle.mjs --lane go > go.oracle.json     # a perfect answer file, built from the key
node --test 'bench/score/test/*.test.mjs'                  # the scorer's own checks
```

Node built-ins only. `score.mjs` exits 0 whenever scoring completed, whatever the tool scored. A
tool that fails every task is a result, not an error. It exits 2 when an input cannot be used: a
file is unreadable, the answer file is malformed, or its `lane` names a different lane from the one
being scored. Answers for ids the lane does not have are listed in the report, so a renamed id
never passes for an unanswered one.

## Answer format

One JSON file per tool and lane.

```json
{
  "version": 1,
  "tool": { "name": "example", "version": "1.2.3" },
  "lane": "go",
  "scope": "repo",
  "answers": {
    "def-free-function": { "locations": [ { "file": "core/money/money.go", "line": 41 } ] },
    "hover-pad-helper":  { "status": "unsupported" },
    "def-through-alias": { "status": "error", "detail": "timed out after 60s" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `tool.name`, `tool.version` | What was scored. Pin the version |
| `scope` | `repo` when the tool indexed the whole checkout, `lane` when it indexed one lane directory. Default `lane` |
| `answers` | Keyed by task id. A task with no entry is `UNANSWERED` |

One answer:

| Field | Meaning |
| --- | --- |
| `status` | `answered` (default), `unsupported` (the tool has no way to be asked this), or `error` (the tool or the adapter failed; say why in `detail`) |
| `locations` | What the tool returned: `file`, `line`, optional `end_line`. Paths are relative to the lane directory, as in `tasks.json`. A location in another lane is written `../<lane>/...` |
| `text` | Any free text the tool returned with the answer, such as a label, a qualified name or a relation. Optional |
| `names` | Symbol names the tool returned, when the answer is a list of names. Optional |
| `unlocated` | How many further results the tool returned without a file and line. Optional, default 0. They count like unexpected locations, so an adapter can never improve a score by dropping them |

### What a line means

- **A declaration** is the line that carries the symbol's name. The scorer matches it by exact line.
  A range never makes it pass, so an answer that returns the enclosing class for a question about
  a member fails. A tool that reports the start of a decorated or attributed declaration is
  normalized by its adapter: move to the first line, at or after the reported start, that contains
  the name the tool reported.
- **A site** (a use, a call site) is matched by containment. `line` to `end_line` may be the range
  of the function the tool reported as the caller; it covers the site when the site's line is
  inside it.
- **A few targets are anchored inside their declaration**, because the declaration line is not
  unique in its file or because the answer is a statement. They are listed by lane and id in
  `TARGET_INSIDE_SYMBOL` in `lib/plan.mjs` and matched by containment, like a site. The list was
  found by reading the targets, so a target missing from it fails a tool that returns the
  declaration line; report one when you find it.

### Scope

Many exclusions in the corpus are lane prefixes such as `php/`: the answer must not land in another
lane. They can only fire when the tool saw the other lanes, so they are checked for `scope: repo`
and reported as not exercised for `scope: lane`.

## The queried symbol

A task's `from` names a line, and a line can hold several identifiers. `from.symbol` says which one
the task asks about, exactly as written on that line and with no qualifier. `from.occurrence`
(1-based) says which one when it appears more than once on the line, and is then required: two
occurrences on a line are often two different symbols. The symbol is the alias where an alias is
used and the member on a member access. It is `null` when the question has no single identifier,
such as a name built at run time. `document_symbol`, `parse-negative` and `diagnostics` tasks ask
about a file and carry neither key.

An adapter takes the question from these keys and never from the answer line, which would leak the
answer into the question. `lib/symbol.mjs` gives it the column:

```js
import { symbolColumn } from "./lib/symbol.mjs";
const column = symbolColumn(lineText, task.from);   // 0-based, or -1 when no symbol is stated
```

The lanes are being annotated (issue #145). `test/symbol.test.mjs` fails on any symbol that is
stated wrongly, and counts the tasks that state none; it becomes strict once every lane has them.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `PASS` | Every scored check passed |
| `FAIL` | A scored check failed; the reason is printed |
| `UNSUPPORTED` | The adapter says the tool cannot be asked this |
| `UNANSWERED` | The answer file has no entry for the task |
| `ERROR` | The tool or adapter failed, or the answer is malformed |
| `UNSCORABLE` | No rule in this version of the scorer covers the task, or the task states no `from.symbol` (its lane is not annotated yet, or the task is a misfit), so no adapter can be asked it |
| `UNRESOLVED` | An expected file is not in the checkout (the php lane's `vendor/` needles before `composer install`) |

The report ends with three ratios. The headline is passed of scorable tasks. Passed of answered
tasks and passed of all tasks follow, so the scorer's own gaps and the tasks a tool skipped are
both visible and neither is counted for or against the tool unnoticed.

## Rules in this version

Semantics come from the rule table in `lib/plan.mjs`, never from the shape of an `expect` block:
the same key means different things in different tasks. A task is scored only when a rule names
its surface and keys. Every key a rule does not use is printed per task as `not scored`.

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `definition/target` | `definition` | `file`, `needle` | the target declaration is returned |
| `definition/candidate` | `definition` | `candidate` | the candidate declaration is returned |
| `resolution/candidate` | `resolution` | `candidate` | the candidate declaration is returned |
| `import-precision/candidate` | `import-precision` | `candidate` | the candidate declaration is returned |

For all four:

- The answer must contain the target, by exact line.
- It may also contain the task's `known_sites`. Any other location makes the answer ambiguous,
  and an ambiguous answer fails.
- Nothing in `must_not_include` may be returned. A known site is never an excluded hit, since the
  key itself lists it.
- A task that carries `exact_count` beside a target is `UNSCORABLE`: the count is an overload
  count in one task and a parameter count in another.
- `kind` and `resolution` are labels and are never scored. The kinds these four rules cover were
  reviewed against the lanes' `notes`. One, `build_generated`, is excluded (`KIND_UNSCORABLE` in
  `lib/plan.mjs`): its key names two places, so a tool that returns either one alone would fail.

Not covered yet, reported `UNSCORABLE`: `references`, `implementation`, `cardinality`,
`multi-parent`, `direction`, `call_hierarchy`, `hover`, `document_symbol`, `parse-negative`,
`diagnostics`, and tasks whose only expectation is a count, a `contains` string or a list of
`known_sites`.

### `must_not_include`

The corpus writes these entries in several forms. Each form has one matching rule. Source text is
matched on the line a location reports and never on the rest of its range, so a declaration's own
body cannot trip an exclusion.

| Form | Example | Hit when |
| --- | --- | --- |
| lane prefix | `php/` | a returned location is under that lane (`scope: repo` only) |
| pattern | `impl .* for Money` | a reported line, or `text`, contains the literal parts in order |
| path and symbol | `app/http#NewServeMux` | a returned location is under the path and its reported line contains the symbol |
| anything else | `models/device.ts`, `BOARD_REFRESH`, `ATELIER_UNIT_SUFFIX = 'u'` | a returned path contains it, a reported line contains it, `names` has it, or `text` contains it |

## How "scorable" is established

By test, not by claim. `test/oracle.test.mjs` runs over every lane and requires, for every task a
rule covers, that the oracle answer passes, that two richer forms of it pass as well (the target
with its full range, and the target with every known site), and that each mutation of it fails: no
location, the line shifted by one, an enclosing range, an unexpected extra location, and one hit
for every `must_not_include` entry.
`test/resolve.test.mjs` rebuilds the verifier report for `bench/conformance/` around the scorer's
resolver and compares it byte for byte with `expected.txt`, so the scorer and the lane verifiers
agree on what a needle resolves to. `test/fixture.test.mjs` pins the report format against a small
lane-shaped fixture.

The number of scorable tasks is computed at run time and printed by the tests and by every report.
It is not written down here, because the lanes change.
